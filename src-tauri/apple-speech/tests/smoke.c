// Isolated C consumer of the shipped static ABI. No microphone/system capture.
// Default: read-only readiness. Only --prepare can request asset installation.
#include "../MimiAppleSpeech.h"
#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t condition = PTHREAD_COND_INITIALIZER;
static bool ready, done, failed, receiver_closed, reject_ready;
static size_t results, finals, late_callbacks;
static FILE *result_file;
static double started, ready_at, audio_started, first_result, last_result;

static double now(void) {
    struct timespec value;
    clock_gettime(CLOCK_MONOTONIC, &value);
    return value.tv_sec + value.tv_nsec / 1e9;
}
static void pause_until(double target) {
    double remaining;
    while ((remaining = target - now()) > 0) {
        struct timespec wait = {(time_t)remaining, (long)((remaining - (time_t)remaining) * 1e9)};
        nanosleep(&wait, NULL);
    }
}
static bool event_is(const char *json, const char *name) {
    char pattern[64];
    snprintf(pattern, sizeof(pattern), "\"event\":\"%s\"", name);
    return strstr(json, pattern) != NULL;
}
static int32_t receive(uint64_t identifier, const uint8_t *bytes, size_t count) {
    if (identifier != 1 || !bytes || !count || count > 262144) return 0;
    char *json = malloc(count + 1);
    if (!json) return 0;
    memcpy(json, bytes, count);
    json[count] = 0;
    pthread_mutex_lock(&lock);
    if (receiver_closed) {
        late_callbacks++;
        pthread_mutex_unlock(&lock);
        free(json);
        return 0;
    }
    if (event_is(json, "capabilities") || event_is(json, "prepared")) {
        puts(json); // Readiness contains only language identifiers and booleans.
        done = true;
    } else if (event_is(json, "ready")) {
        ready = true;
        ready_at = now() - started;
    } else if (event_is(json, "result")) {
        double elapsed = now() - started;
        if (!results) first_result = elapsed;
        last_result = elapsed;
        results++;
        if (strstr(json, "\"final\":true")) finals++;
        if (result_file) {
            // Explicit functional output; never write transcripts to diagnostics.
            if (fwrite(json, 1, count, result_file) != count || fputc('\n', result_file) == EOF) failed = true;
        }
    } else if (event_is(json, "done")) {
        done = true;
    } else if (event_is(json, "error")) {
        puts(json); // The ABI permits only a sanitized domain and numeric code.
        failed = true;
    } else {
        failed = true;
    }
    bool accepted = !failed && !(reject_ready && ready);
    if (!accepted) receiver_closed = true;
    pthread_cond_broadcast(&condition);
    pthread_mutex_unlock(&lock);
    free(json);
    return accepted ? 1 : 0;
}
static bool wait_for(bool want_ready, unsigned seconds) {
    struct timespec deadline;
    clock_gettime(CLOCK_REALTIME, &deadline);
    deadline.tv_sec += seconds;
    pthread_mutex_lock(&lock);
    while (!failed && !(want_ready ? ready : done)) {
        if (pthread_cond_timedwait(&condition, &lock, &deadline) == ETIMEDOUT) {
            failed = true;
            fputs("{\"event\":\"timeout\"}\n", stderr);
        }
    }
    bool success = !failed;
    pthread_mutex_unlock(&lock);
    return success;
}
static uint16_t u16(const uint8_t *p) { return (uint16_t)(p[0] | (p[1] << 8)); }
static uint32_t u32(const uint8_t *p) { return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24); }
static bool wave_data(FILE *file, uint32_t *length) {
    uint8_t header[12], chunk[8], format[16];
    if (fread(header, 1, 12, file) != 12 || memcmp(header, "RIFF", 4) || memcmp(header + 8, "WAVE", 4)) return false;
    bool valid_format = false;
    while (fread(chunk, 1, 8, file) == 8) {
        uint32_t size = u32(chunk + 4);
        if (!memcmp(chunk, "fmt ", 4)) {
            if (size < 16 || fread(format, 1, 16, file) != 16) return false;
            valid_format = u16(format) == 1 && u16(format + 2) == 1 && u32(format + 4) == 16000 && u16(format + 14) == 16;
            if (fseek(file, (long)(size - 16) + (size & 1), SEEK_CUR)) return false;
        } else if (!memcmp(chunk, "data", 4)) {
            *length = size;
            return valid_format && size > 0 && size % 2 == 0;
        } else if (fseek(file, (long)size + (size & 1), SEEK_CUR)) return false;
    }
    return false;
}
static void close_receiver(void) {
    pthread_mutex_lock(&lock);
    receiver_closed = true;
    pthread_mutex_unlock(&lock);
    mimi_apple_speech_cancel(1);
}
int main(int argc, char **argv) {
    const char *mode = argc > 1 ? argv[1] : "--query";
    const char *locale = argc > 2 ? argv[2] : "en-US";
    bool query = !strcmp(mode, "--query"), prepare = !strcmp(mode, "--prepare");
    bool empty = !strcmp(mode, "--empty"), cancel = !strcmp(mode, "--cancel");
    bool transcribe = !strcmp(mode, "--transcribe");
    reject_ready = !strcmp(mode, "--reject");
    if (!(query || prepare || empty || cancel || reject_ready || transcribe) || (transcribe && argc != 4 && argc != 6) || (argc == 6 && strcmp(argv[4], "--results"))) {
        fputs("usage: smoke [--query | --prepare LOCALE | --empty LOCALE | --cancel LOCALE | --reject LOCALE | --transcribe LOCALE PCM16_WAV [--results NEW_JSONL]]\n", stderr);
        return 2;
    }
    FILE *input = NULL;
    uint32_t remaining = 0;
    if (transcribe) {
        input = fopen(argv[3], "rb");
        if (!input || !wave_data(input, &remaining)) { fputs("invalid PCM16LE mono 16 kHz WAV\n", stderr); return 2; }
        if (argc == 6) {
            int descriptor = open(argv[5], O_WRONLY | O_CREAT | O_EXCL, S_IRUSR | S_IWUSR);
            result_file = descriptor < 0 ? NULL : fdopen(descriptor, "w");
            if (!result_file) { fputs("cannot create result output\n", stderr); return 2; }
        }
    }
    started = now();
    if (query) mimi_apple_speech_query(1, receive);
    else if (prepare) mimi_apple_speech_prepare(1, locale, receive);
    else mimi_apple_speech_start(1, locale, receive);
    bool success = wait_for(!(query || prepare), prepare ? 600 : 15);
    if (success && !(query || prepare)) {
        if (cancel || reject_ready) {
            // Rejection must stop the native session by itself; --cancel
            // separately exercises explicit caller-driven cancellation.
            if (cancel) close_receiver();
            pause_until(now() + 0.25);
            uint8_t pcm[2] = {0};
            success = mimi_apple_speech_push(1, pcm, 2) == 3;
        } else {
            uint8_t pcm[640]; // 20 ms chunks, fed at audio time, at most 1 s queued.
            size_t sent = 0;
            double audio_start = now();
            audio_started = audio_start - started;
            while (remaining && success) {
                size_t count = remaining < sizeof(pcm) ? remaining : sizeof(pcm);
                success = fread(pcm, 1, count, input) == count && mimi_apple_speech_push(1, pcm, count) == 0;
                remaining -= (uint32_t)count;
                sent += count;
                pause_until(audio_start + (double)sent / 32000);
            }
            double eof = now();
            mimi_apple_speech_finish(1);
            success = success && wait_for(false, 3);
            printf("{\"event\":\"flush\",\"elapsed_ms\":%.1f,\"pcm_bytes\":%zu}\n", (now() - eof) * 1000, sent);
        }
    }
    close_receiver();
    pthread_mutex_lock(&lock);
    printf("{\"event\":\"summary\",\"success\":%s,\"results\":%zu,\"finals\":%zu,\"late_callbacks\":%zu,\"first_result_ms\":%.1f,\"last_result_ms\":%.1f,\"elapsed_ms\":%.1f}\n", success ? "true" : "false", results, finals, late_callbacks, first_result * 1000, last_result * 1000, (now() - started) * 1000);
    printf("{\"event\":\"timing\",\"ready_ms\":%.1f,\"first_result_after_audio_ms\":%.1f}\n", ready_at * 1000, results ? (first_result - audio_started) * 1000 : 0);
    if (result_file) fclose(result_file);
    pthread_mutex_unlock(&lock);
    if (input) fclose(input);
    return success ? 0 : 1;
}

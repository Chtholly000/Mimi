#ifndef MIMI_APPLE_SPEECH_H
#define MIMI_APPLE_SPEECH_H
#include <stddef.h>
#include <stdint.h>

// JSON is borrowed only until the callback returns. Copy anything retained.
// Return 0 to stop delivery. IDs must be unique while any old callback can run;
// cancellation may race an in-flight callback, so remove the receiver first.
// Callbacks must not call back into the bridge synchronously.
typedef int32_t (*MimiSpeechCallback)(uint64_t, const uint8_t *, size_t);
void mimi_apple_speech_query(uint64_t, MimiSpeechCallback);
void mimi_apple_speech_prepare(uint64_t, const char *, MimiSpeechCallback);
void mimi_apple_speech_start(uint64_t, const char *, MimiSpeechCallback);
// 16 kHz mono PCM16LE; 0 accepted, 1 invalid, 2 overflow, 3 closed.
int32_t mimi_apple_speech_push(uint64_t, const uint8_t *, size_t);
void mimi_apple_speech_finish(uint64_t);
void mimi_apple_speech_cancel(uint64_t);
#endif

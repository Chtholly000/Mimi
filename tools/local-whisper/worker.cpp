// Bounded binary requests on stdin; JSON responses on stdout. No capture/files.
#include "whisper.h"
#include <chrono>
#include <cstdint>
#include <iostream>
#include <string>
#include <vector>

using Clock = std::chrono::steady_clock;
static double millis(Clock::time_point start) {
    return std::chrono::duration<double, std::milli>(Clock::now() - start).count();
}
static std::string quoted(const std::string & text) {
    std::string result = "\"";
    const char * hex = "0123456789abcdef";
    for (unsigned char c : text) {
        if (c == '"' || c == '\\') { result += '\\'; result += c; }
        else if (c < 32) { result += "\\u00"; result += hex[c >> 4]; result += hex[c & 15]; }
        else { result += c; }
    }
    return result + '"';
}
int main(int argc, char ** argv) {
    if (argc != 2) { return 2; }
    whisper_log_set([](ggml_log_level, const char *, void *) {}, nullptr);
    auto started = Clock::now();
    auto options = whisper_context_default_params();
    options.use_gpu = true;
    options.flash_attn = true;
    auto * ctx = whisper_init_from_file_with_params(argv[1], options);
    if (!ctx) { return 3; }
    std::cout << "{\"event\":\"ready\",\"load_ms\":" << millis(started) << "}" << std::endl;
    int result = 0;
    while (true) {
        unsigned char header[5];
        std::cin.read(reinterpret_cast<char *>(header), sizeof(header));
        if (std::cin.gcount() == 0 && std::cin.eof()) { break; }
        if (std::cin.gcount() != sizeof(header)) { result = 4; break; }
        const uint32_t bytes = uint32_t(header[0]) | uint32_t(header[1]) << 8 |
            uint32_t(header[2]) << 16 | uint32_t(header[3]) << 24;
        if (bytes < 640 || bytes > 256000 || bytes % 2 || header[4] < 2 || header[4] > 4) {
            result = 4; break;
        }
        std::string language(header[4], '\0');
        std::cin.read(language.data(), language.size());
        if (!std::cin || (language != "auto" && whisper_lang_id(language.c_str()) < 0)) {
            result = 4; break;
        }
        std::vector<unsigned char> pcm(bytes);
        std::cin.read(reinterpret_cast<char *>(pcm.data()), bytes);
        if (!std::cin) { result = 4; break; }
        std::vector<float> samples(bytes / 2);
        for (size_t i = 0; i < samples.size(); ++i) {
            const auto sample = static_cast<int16_t>(uint16_t(pcm[i * 2]) | uint16_t(pcm[i * 2 + 1]) << 8);
            samples[i] = float(sample) / 32768.0f;
        }
        auto params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
        params.n_threads = 4;
        params.translate = false;
        params.no_context = true;
        params.no_timestamps = true;
        params.single_segment = true;
        params.print_realtime = params.print_progress = params.print_timestamps = false;
        params.suppress_nst = true;
        params.language = language.c_str();
        params.temperature_inc = 0.0f;
        params.max_tokens = 192;
        started = Clock::now();
        if (whisper_full(ctx, params, samples.data(), int(samples.size())) != 0) { result = 5; break; }
        std::string text;
        for (int i = 0; i < whisper_full_n_segments(ctx); ++i) {
            text += whisper_full_get_segment_text(ctx, i);
            if (text.size() > 65536) { result = 6; break; }
        }
        if (result) { break; }
        std::cout << "{\"event\":\"result\",\"text\":" << quoted(text)
                  << ",\"decode_ms\":" << millis(started) << "}" << std::endl;
    }
    whisper_free(ctx);
    return result;
}

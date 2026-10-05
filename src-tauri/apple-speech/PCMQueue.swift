import Foundation

/// A single-consumer input sequence mailbox. The audio callback only copies
/// bounded PCM; model work and awaiting happen on the analyzer's task.
final class PCMQueue: @unchecked Sendable {
    enum PushResult: Int32 { case accepted = 0, invalid = 1, overflow = 2, closed = 3 }
    private let lock = NSLock()
    private let maximumBytes: Int
    private var chunks: [Data] = []
    private var bytes = 0
    private var ended = false
    private var waiter: CheckedContinuation<Data?, Never>?

    init(maximumBytes: Int = 32_000) { self.maximumBytes = maximumBytes }

    func push(_ data: Data) -> PushResult {
        guard !data.isEmpty, data.count.isMultiple(of: 2) else { return .invalid }
        lock.lock()
        guard !ended else { lock.unlock(); return .closed }
        guard data.count <= maximumBytes - bytes else { lock.unlock(); return .overflow }
        if let waiting = waiter {
            waiter = nil
            lock.unlock()
            waiting.resume(returning: data)
        } else {
            chunks.append(data)
            bytes += data.count
            lock.unlock()
        }
        return .accepted
    }

    func next() async -> Data? {
        await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                lock.lock()
                if !chunks.isEmpty {
                    let data = chunks.removeFirst()
                    bytes -= data.count
                    lock.unlock()
                    continuation.resume(returning: data)
                } else if ended || Task.isCancelled {
                    lock.unlock()
                    continuation.resume(returning: nil)
                } else {
                    // SpeechAnalyzer consumes one input sequence at a time.
                    precondition(waiter == nil)
                    waiter = continuation
                    lock.unlock()
                }
            }
        } onCancel: {
            self.cancel()
        }
    }

    func finish() { end(discard: false) }
    func cancel() { end(discard: true) }

    private func end(discard: Bool) {
        lock.lock()
        ended = true
        if discard { chunks.removeAll(); bytes = 0 }
        let waiting = waiter
        waiter = nil
        lock.unlock()
        waiting?.resume(returning: nil)
    }
}

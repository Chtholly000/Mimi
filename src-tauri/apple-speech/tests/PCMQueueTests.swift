import Foundation

@main
struct PCMQueueTests {
    static func main() async {
        let queue = PCMQueue(maximumBytes: 4)
        precondition(queue.push(Data([1])) == .invalid)
        precondition(queue.push(Data([1, 2])) == .accepted)
        precondition(queue.push(Data([3, 4])) == .accepted)
        precondition(queue.push(Data([5, 6])) == .overflow)
        queue.finish()
        precondition(queue.push(Data([7, 8])) == .closed)
        let first = await queue.next()
        let second = await queue.next()
        let end = await queue.next()
        precondition(first == Data([1, 2]) && second == Data([3, 4]) && end == nil)

        let cancelled = PCMQueue()
        precondition(cancelled.push(Data([1, 2])) == .accepted)
        cancelled.cancel()
        let discarded = await cancelled.next()
        precondition(discarded == nil)

        let waiting = PCMQueue()
        let consumer = Task { await waiting.next() }
        consumer.cancel()
        let interrupted = await consumer.value
        precondition(interrupted == nil)
        precondition(waiting.push(Data([1, 2])) == .closed)
        print("PCMQueue: bounded overflow, EOF drain, cancellation passed")
    }
}

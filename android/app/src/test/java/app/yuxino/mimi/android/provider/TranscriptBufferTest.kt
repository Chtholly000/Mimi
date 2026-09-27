package app.yuxino.mimi.android.provider

import org.junit.Assert.*
import org.junit.Test

class TranscriptBufferTest {
    @Test fun sentenceAndFollowingDraftAreBothReturned() {
        val buffer = TranscriptBuffer()
        buffer.append("Hello")
        val update = buffer.append(" world. Next thought")
        assertEquals("Hello world.", update.final)
        assertEquals(" Next thought", update.draft)
        assertEquals("Next thought ends.", buffer.append(" ends.").final)
    }

    @Test fun longStreamWithoutPunctuationIsBoundedAndAdvances() {
        val buffer = TranscriptBuffer()
        repeat(100) { buffer.append("a".repeat(200)) }
        val update = buffer.append("RECENT")
        assertNull(update.final)
        assertEquals(TranscriptBuffer.MAX_CHARS, update.draft.length)
        assertTrue(update.draft.endsWith("RECENT"))
    }

    @Test fun largeSingleEventIsAlsoBounded() {
        val update = TranscriptBuffer().append("a".repeat(50_000))
        assertEquals(TranscriptBuffer.MAX_CHARS, update.draft.length)
    }
}

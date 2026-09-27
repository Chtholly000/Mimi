package app.yuxino.mimi.android.provider

import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class SubtitleBusTest {
    @Before fun reset() {
        SubtitleBus.clear()
        SubtitleBus.setHistoryLimit(0)
    }

    @After fun cleanup() = reset()

    @Test fun disabledHistoryDoesNotRetainPastSources() {
        SubtitleBus.onSourceFinal("Earlier private sentence.")
        SubtitleBus.onTranslationFinal("Earlier private translation.")
        assertTrue(SubtitleBus.historySnapshot().isEmpty())
        SubtitleBus.setHistoryLimit(6)
        SubtitleBus.onSourceFinal("Current sentence.")
        SubtitleBus.onTranslationFinal("Current translation.")
        assertEquals(listOf(SubtitleBus.Pair("Current sentence", "Current translation")), SubtitleBus.historySnapshot())
    }

    @Test fun disablingHistoryClearsPendingSourcesAndSnapshot() {
        SubtitleBus.setHistoryLimit(6)
        SubtitleBus.onSourceFinal("Old source.")
        SubtitleBus.onTranslationFinal("Old translation.")
        SubtitleBus.onSourceFinal("Old pending.")
        SubtitleBus.setHistoryLimit(0)
        assertTrue(SubtitleBus.historySnapshot().isEmpty())
        SubtitleBus.setHistoryLimit(6)
        SubtitleBus.onSourceFinal("New source.")
        SubtitleBus.onTranslationFinal("New translation.")
        assertEquals("New source", SubtitleBus.historySnapshot().single().source)
    }

    @Test fun historyLimitMatchesSettingAndSnapshotsStayStable() {
        SubtitleBus.setHistoryLimit(6)
        repeat(7) {
            SubtitleBus.onSourceFinal("source $it")
            SubtitleBus.onTranslationFinal("translation $it")
        }
        val snapshot = SubtitleBus.historySnapshot()
        assertEquals(6, snapshot.size)
        assertEquals("source 1", snapshot.first().source)
        SubtitleBus.setHistoryLimit(2)
        assertEquals(2, SubtitleBus.historySnapshot().size)
        assertEquals(6, snapshot.size)
    }

    @Test fun newSessionResetsLanguageAndVisibility() {
        SubtitleBus.onSourceDraft("Hello", "en-US")
        SubtitleBus.hideLive()
        SubtitleBus.clear()
        assertNull(SubtitleBus.detectedSourceLanguage)
        assertFalse(SubtitleBus.liveHidden)
        assertEquals("", SubtitleBus.sourceDraft)
    }

    @Test fun finalWithTrailingWhitespaceStillDisplaysLastSentence() {
        SubtitleBus.onTranslationFinal("First sentence. Last sentence.  \n")
        assertEquals("Last sentence", SubtitleBus.translationFinal)
    }

    @Test fun unpunctuatedDraftKeepsMostRecentText() {
        SubtitleBus.onTranslationDraft("a".repeat(220) + "RECENT")
        assertEquals(200, SubtitleBus.translationDraft.length)
        assertTrue(SubtitleBus.translationDraft.endsWith("RECENT"))
    }
}

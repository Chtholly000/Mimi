package app.yuxino.mimi.android

import org.junit.Assert.*
import org.junit.Test

class FirstRunEvidenceTest {
    @Test fun requiresSoundSubmittedAndRealVisibleCaptionInSameSession() {
        val proof = FirstRunEvidence()
        proof.rendered(true, true, false)
        assertFalse(proof.complete)
        proof.submitted(byteArrayOf(0, 0))
        assertFalse(proof.audioSubmitted)
        proof.submitted(byteArrayOf(1, 0))
        proof.rendered(true, true, true)
        proof.rendered(true, false, false)
        proof.rendered(false, true, false)
        assertFalse(proof.complete)
        proof.rendered(true, true, false)
        assertTrue(proof.complete)
        proof.reset()
        assertFalse(proof.complete)
        proof.rendered(true, true, false)
        assertFalse(proof.complete)
    }
}

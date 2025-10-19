module.exports = function (text) {
    // --- 1. Pattern fingerprints (LLM tone, phrasing, politeness) ---
    const patterns = [
        // Polite or formal intros
        /^(Of course|Certainly|Absolutely|Sure|Indeed|Yes,|Definitely|I agree)\b/i,

        // Offers to help or continue
        /\bLet me know if\b/i,
        /\bWould you like me to\b/i,
        /\bIs there anything else I can (help|assist) with\b/i,
        /\bIf you’d like, we can (talk|move) about something else\b/i,
        /\bI’d be happy to help\b/i,

        // Explanatory / moral tone
        /\bThis (shows|means|illustrates|demonstrates|represents)\b/i,
        /\bIt highlights the importance of\b/i,
        /\bIt suggests that\b/i,

        // Soft transitions and balance
        /\bIn other words\b/i,
        /\bAs you mentioned\b/i,
        /\bThat’s a great point\b/i,
        /\bAt the same time\b/i,
        /\bOverall\b/i,
        /\bUltimately\b/i,

        // Positive and balanced phrasing
        /\bThat’s (really|very|quite) (interesting|important|good|nice|helpful)\b/i,
        /\bI understand what you mean\b/i,
        /\bI can see why you’d say that\b/i,
        /\bIt’s always good to\b/i,

        // Synthetic empathy or polite closure
        /\bI hope (you|your).* (well|great|good|wonderful)\b/i,
        /\bTake care\b/i,
        /\bHave a (great|good|nice) day\b/i
    ];

    // --- Pattern score ---
    const matched = patterns.filter(p => p.test(text));
    const patternScore = Math.min(matched.length / 5, 1); // cap at 1

    // --- 2. Stylistic analysis ---
    const sentences = text
        .replace(/[!?]/g, '.')
        .split('.')
        .map(s => s.trim())
        .filter(Boolean);

    const sentenceLengths = sentences.map(s => s.split(/\s+/).length);
    const avgLen =
        sentenceLengths.reduce((a, b) => a + b, 0) / (sentenceLengths.length || 1);
    const variance =
        sentenceLengths.reduce((a, b) => a + Math.pow(b - avgLen, 2), 0) /
        (sentenceLengths.length || 1);
    const stdDev = Math.sqrt(variance);

    // LLMs: low stdDev (uniform sentence length)
    const styleUniformity = Math.max(0, 1 - stdDev / 8);

    // --- 3. Lexical diversity ---
    const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const unique = new Set(words);
    const ttr = unique.size / (words.length || 1);
    // LLMs ~0.35–0.45; humans higher/lower depending on topic
    const lexicalScore = Math.max(0, 0.6 - Math.abs(ttr - 0.4));

    // --- Combine all ---
    const confidence = Math.min(
        patternScore * 0.5 + styleUniformity * 0.3 + lexicalScore * 0.2,
        1
    );

    return {
        isLikelyLLM: confidence > 0.5,
        confidence: +confidence.toFixed(2),
        matchedPatterns: matched.map(p => p.source),
        metrics: {
            avgSentenceLength: +avgLen.toFixed(1),
            sentenceStdDev: +stdDev.toFixed(1),
            lexicalDiversity: +ttr.toFixed(2)
        }
    };
}

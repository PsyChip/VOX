module.exports = function (text) {
    const patterns = [
        /^(Elbette|Kesinlikle|Esenlikle|Tabii ki|Evet|Doğru|Gerçekten|Aynen)\b/i,
        /yardımcı olabileceğim başka bir şey var mı/i,
        /istersen (başka|farklı) bir konuya geçebiliriz/i,
        /başka (bir şey|bir konu) hakkında konuşabiliriz/i,
        /sohbet etmek istersen/i,
        /\b(anlatır|vurguluyor|ifade ediyor|belirtiyor|gösteriyor|anlamına gelir|temsil eder)\b/i,
        /\b(tıpkı .* gibi|benzer şekilde|aynı şekilde)\b/i,
        /\b(sonuç olarak|bir anlamda|bu nedenle|kısacası)\b/i,
        /\b(bu gerçekten|bu oldukça|bence bu)\b/i,
        /\b(güzel|harika|keyifli|olumlu|etkileyici|ilginç) bir (deneyim|örnek|durum|konu)\b/i,
        /\b(umarım|dilerim) .* (güzel|harika|keyifli|mutlu)\b/i,
        /\bpaylaşım ve sohbet\b/i,
        /\bmemnuniyetle\b/i,
        /\bben de (böyle|aynı şekilde|benzer) düşünüyorum\b/i,
        /\bhayatımda (pek çok|birçok) kez deneyimledim\b/i,
        /\bbence önemli bir konu\b/i,
        /\b(sen ne düşünüyorsun|senin fikrin ne|katılıyor musun|senin görüşün nedir)\b/i
    ];

    // --- Pattern score ---
    const matched = patterns.filter(p => p.test(text));
    const patternScore = Math.min(matched.length / 5, 1); // cap at 1

    // --- Stylistic analysis ---
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

    const styleUniformity = Math.max(0, 1 - stdDev / 8);

    const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const unique = new Set(words);
    const ttr = unique.size / (words.length || 1);
    const lexicalScore = Math.max(0, 0.6 - Math.abs(ttr - 0.4));

    const confidence = Math.min(
        (patternScore * 0.5 + styleUniformity * 0.3 + lexicalScore * 0.2),
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
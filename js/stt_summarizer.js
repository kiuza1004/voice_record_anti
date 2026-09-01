/**
 * STT & Summarizer Module
 * - Web Speech API (브라우저 내장 무료 음성인식)
 * - 200자 이내 요약 엔진 (무료 로컬 알고리즘 + 선택적 Gemini API)
 */
class STTSummarizer {
    constructor() {
        this.recognition = null;
        this.isRecognizing = false;
        this.transcriptBuffer = [];
        this.onLiveTranscriptCallback = null;
        this.initSpeechRecognition();
    }

    initSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.warn('이 브라우저는 Web Speech API를 지원하지 않습니다.');
            return;
        }

        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true; // 백그라운드 정밀 캡처를 위해 true 설정
        this.recognition.lang = 'ko-KR';

        this.lastProcessedIndex = 0;

        this.recognition.onresult = (event) => {
            let latestInterim = '';

            for (let i = event.resultIndex; i < event.results.length; ++i) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    if (i >= this.lastProcessedIndex) {
                        this.pushOrUpdateTranscriptBuffer(transcript);
                        this.lastProcessedIndex = i + 1;
                    }
                } else {
                    latestInterim += transcript;
                }
            }

            // 중간 인식 텍스트도 버퍼에 누적 보정
            if (latestInterim.trim()) {
                this.pushOrUpdateTranscriptBuffer(latestInterim);
            }
        };

        this.recognition.onend = () => {
            // 외부에서 비동기 종료를 대기 중이면 resolve 호출
            if (this.onStopResolve) {
                this.onStopResolve();
                this.onStopResolve = null;
            }

            // 녹음 중 상태인데 수동으로 끝난 경우 자동 재연결
            if (this.isRecognizing) {
                try {
                    this.recognition.start();
                } catch (e) {
                    console.log('STT 재시작 시도 중...', e);
                }
            }
        };

        this.recognition.onerror = (event) => {
            console.error('STT 에러:', event.error);
        };
    }

    pushOrUpdateTranscriptBuffer(text) {
        const trimmed = text.trim();
        if (!trimmed) return;

        if (this.transcriptBuffer.length === 0) {
            this.transcriptBuffer.push(trimmed);
            return;
        }

        const lastIdx = this.transcriptBuffer.length - 1;
        const lastText = this.transcriptBuffer[lastIdx];

        // 1. 완전 동일 시 무시
        if (lastText === trimmed) return;

        // 2. 새 인식 결과(trimmed)가 기존 결과(lastText)를 확장/포함하는 경우 -> 기존 결과 교체 (예: "1" -> "1 2" -> "1 2 3 4")
        if (trimmed.startsWith(lastText)) {
            this.transcriptBuffer[lastIdx] = trimmed;
            return;
        }

        // 3. 기존 결과가 새 인식 결과를 포함하는 경우 -> 무시
        if (lastText.startsWith(trimmed)) {
            return;
        }

        // 4. 공백 제거 후 비교 (단어 단위 조립 보정)
        const cleanLast = lastText.replace(/\s+/g, '');
        const cleanTrimmed = trimmed.replace(/\s+/g, '');
        if (cleanTrimmed.startsWith(cleanLast)) {
            this.transcriptBuffer[lastIdx] = trimmed;
            return;
        }
        if (cleanLast.startsWith(cleanTrimmed)) {
            return;
        }

        // 5. 단어 부분 겹침 병합 처리 (예: "오늘 날씨가" + "날씨가 좋습니다" -> "오늘 날씨가 좋습니다")
        const lastWords = lastText.split(' ');
        const trimmedWords = trimmed.split(' ');

        let overlapMatchCount = 0;
        for (let i = 0; i < lastWords.length; i++) {
            const lastSub = lastWords.slice(i).join(' ');
            const trimSub = trimmedWords.slice(0, lastWords.length - i).join(' ');
            if (lastSub && lastSub === trimSub) {
                overlapMatchCount = lastWords.length - i;
                break;
            }
        }

        if (overlapMatchCount > 0) {
            const merged = lastWords.slice(0, lastWords.length - overlapMatchCount).concat(trimmedWords).join(' ');
            this.transcriptBuffer[lastIdx] = merged;
            return;
        }

        // 6. 중복 없이 독립된 새 문장이면 버퍼에 추가
        this.transcriptBuffer.push(trimmed);
    }

    startListening(onLiveTranscript) {
        if (!this.recognition) return false;
        this.onLiveTranscriptCallback = onLiveTranscript;
        this.transcriptBuffer = [];
        this.lastProcessedIndex = 0;
        this.isRecognizing = true;
        try {
            this.recognition.start();
            return true;
        } catch (e) {
            console.error('STT 시작 실패:', e);
            return false;
        }
    }

    async stopListening() {
        this.isRecognizing = false;
        if (this.recognition) {
            try {
                // 비동기적으로 onend 이벤트가 호출될 때까지 대기하여 마지막 버퍼까지 완전히 수집함
                await new Promise((resolve) => {
                    this.onStopResolve = resolve;
                    this.recognition.stop();
                    // 만일 브라우저 버그로 1.5초 내에 onend가 오지 않으면 안전하게 resolve 강제 실행
                    setTimeout(() => {
                        if (this.onStopResolve) {
                            this.onStopResolve();
                            this.onStopResolve = null;
                        }
                    }, 1500);
                });
            } catch (e) {
                console.error('STT 중지 에러:', e);
            }
        }
        return this.getBufferedText();
    }

    getBufferedText() {
        return this.transcriptBuffer.join(' ').trim();
    }

    /**
     * 200자 이내 요약 생성 기능
     * @param {string} rawText 원본 녹음 텍스트
     * @param {boolean} hasAudioBlob 오디오 파일 존재 여부
     * @returns {Promise<string>} 200자 이내 요약문
     */
    async summarizeText(rawText, hasAudioBlob = false) {
        if (!rawText || rawText.trim().length === 0) {
            if (hasAudioBlob) {
                return "🎵 [음성 오디오 저장 완료] 텍스트 변환 결과는 없으나 음성 오디오가 정상 보관되었습니다. (하단 오디오 들어보기 클릭)";
            }
            return "녹음된 일상 대화나 소리가 없습니다.";
        }

        const apiKey = localStorage.getItem('gemini_api_key');

        // Gemini API 키가 제공되어 있으면 Gemini Free Tier 사용
        if (apiKey && apiKey.trim().length > 0) {
            try {
                const geminiSummary = await this.fetchGeminiSummary(rawText, apiKey);
                if (geminiSummary) {
                    return geminiSummary.substring(0, 200);
                }
            } catch (e) {
                console.warn('Gemini API 요약 실패, 로컬 요약기로 전환합니다:', e);
            }
        }

        // 기본 무료 로컬 요약 알고리즘 (핵심 문장 추출 + 200자 제한)
        return this.localSummarize(rawText);
    }

    // 로컬 핵심문장 추출 및 200자 요약 알고리즘 (0원 비용)
    localSummarize(text) {
        const cleanText = text.replace(/\s+/g, ' ').trim();
        if (cleanText.length <= 200) {
            return cleanText;
        }

        // 문장 단위 분할
        const sentences = cleanText.split(/(?<=[.?!])\s+/);
        let summary = "";

        for (const sentence of sentences) {
            if ((summary + sentence).length <= 195) {
                summary += (summary ? " " : "") + sentence;
            } else {
                break;
            }
        }

        if (!summary) {
            summary = cleanText.substring(0, 195) + "...";
        }

        return summary;
    }

    // 선택적 Gemini API 사용
    async fetchGeminiSummary(text, apiKey) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        const prompt = `다음은 1시간 동안 녹음된 일상 대화/소리 텍스트입니다. 이 내용을 바탕으로 무슨 일이 있었는지 한국어로 정확히 200자 이내로 일기 형식으로 간결하게 정리 요약해 주세요.\n\n텍스트: ${text}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        if (!response.ok) throw new Error('API Request failed');
        const data = await response.json();
        return data.candidates[0].content.parts[0].text;
    }

    /**
     * 로컬 키워드 자동 추출 (비용 0원)
     * @param {string} text 일상 기록 텍스트
     * @returns {Array<string>} 추출된 주요 키워드 배열 (예: ['#회의', '#식사'])
     */
    extractTopKeywords(text) {
        if (!text || text.trim().length === 0) return [];

        // 불용어 (조사, 어미, 특수문자 등)
        const stopWords = new Set([
            '것', '수', '등', '를', '을', '이', '가', '은', '는', '에', '와', '과', '으로', '로',
            '도', '하고', '입니다', '합니다', '있습니다', '없습니다', '오늘', '녹음', '소리', '대화',
            '완료', '결과', '보관', '통해', '해서', '에서', '그리고', '하지만', '또는', '저희', '우리'
        ]);

        const words = text.replace(/[*📌💡🔍📅#\-!?,.()"]/g, ' ')
            .split(/\s+/)
            .map(w => w.trim())
            .filter(w => w.length >= 2 && !stopWords.has(w));

        const freq = {};
        words.forEach(w => {
            freq[w] = (freq[w] || 0) + 1;
        });

        const sorted = Object.keys(freq).sort((a, b) => freq[b] - freq[a]);
        return sorted.slice(0, 3).map(k => `#${k}`);
    }
}

window.sttSummarizer = new STTSummarizer();

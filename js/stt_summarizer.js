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
        this.recognition.interimResults = true;
        this.recognition.lang = 'ko-KR';

        this.recognition.onresult = (event) => {
            let interimTranscript = '';
            let finalTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript + ' ';
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }

            if (finalTranscript.trim()) {
                this.transcriptBuffer.push(finalTranscript.trim());
            }

            if (this.onLiveTranscriptCallback) {
                const currentFull = this.getBufferedText() + ' ' + interimTranscript;
                this.onLiveTranscriptCallback(currentFull);
            }
        };

        this.recognition.onend = () => {
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

    startListening(onLiveTranscript) {
        if (!this.recognition) return false;
        this.onLiveTranscriptCallback = onLiveTranscript;
        this.transcriptBuffer = [];
        this.isRecognizing = true;
        try {
            this.recognition.start();
            return true;
        } catch (e) {
            console.error('STT 시작 실패:', e);
            return false;
        }
    }

    stopListening() {
        this.isRecognizing = false;
        if (this.recognition) {
            try {
                this.recognition.stop();
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
     * @returns {Promise<string>} 200자 이내 요약문
     */
    async summarizeText(rawText) {
        if (!rawText || rawText.trim().length === 0) {
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
}

window.sttSummarizer = new STTSummarizer();

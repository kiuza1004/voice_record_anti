/**
 * QAAssistant Module - 자연어 질의응답, 일자별 이벤트 검색 및 TTS 음성 설명
 */
class LifeLogQAAssistant {
    constructor() {
        this.synth = window.speechSynthesis;
    }

    /**
     * 사용자의 질의어에 대해 일자별/시간별 기록 검색 및 답변 생성
     * @param {string} query 질문 텍스트
     * @returns {Promise<{answer: string, matchedItems: Array}>}
     */
    async searchAndAnswer(query) {
        if (!query || !query.trim()) {
            return {
                answer: "질문할 내용을 입력해 주세요.",
                matchedItems: []
            };
        }

        const logs = await window.lifeLogStorage.getAllLogs();
        if (!logs || logs.length === 0) {
            return {
                answer: "아직 저장된 일상 녹음 기록이 없습니다. 먼저 자동 녹음을 진행해 주세요.",
                matchedItems: []
            };
        }

        const normalizedQuery = query.toLowerCase().trim();
        const keywords = normalizedQuery.split(/\s+/).filter(k => k.length > 1);

        // 검색 필터링
        const matchedItems = logs.filter(log => {
            const dateStr = log.dateString;
            const textContent = (log.summary + " " + log.rawText + " " + log.timeRange).toLowerCase();

            // "오늘", "어제" 키워드 처리
            const today = new Date().toISOString().split('T')[0];
            const yesterdayDate = new Date(Date.now() - 86400000).toISOString().split('T')[0];

            if (normalizedQuery.includes('오늘') && dateStr === today) return true;
            if (normalizedQuery.includes('어제') && dateStr === yesterdayDate) return true;

            // 키워드 매칭
            return keywords.some(kw => textContent.includes(kw));
        });

        if (matchedItems.length === 0) {
            // 키워드 매칭 실패시 최근 3개 기록 반환
            const recent = logs.slice(0, 3);
            let answerText = `"${query}"와 관련된 특정 기록을 찾지 못했습니다. 최근 작성된 기록을 알려드릴게요:\n\n`;
            recent.forEach(item => {
                answerText += `📌 [${item.dateString} ${item.timeRange}]\n- 요약: ${item.summary}\n\n`;
            });
            return {
                answer: answerText,
                matchedItems: recent
            };
        }

        // 매칭된 기록 정리
        let answerText = `🔍 "${query}"에 대한 검색 결과입니다 (총 ${matchedItems.length}건 찾음):\n\n`;
        matchedItems.forEach(item => {
            answerText += `📅 **${item.dateString} (${item.timeRange})**\n💡 ${item.summary}\n\n`;
        });

        return {
            answer: answerText,
            matchedItems
        };
    }

    /**
     * 답변 내용을 말로 설명해주는 TTS (Text-to-Speech) 기능
     * @param {string} text 읽어줄 텍스트
     * @param {Function} onStart 말하기 시작 시 콜백
     * @param {Function} onEnd 말하기 종료/중지 시 콜백
     */
    speak(text, onStart = null, onEnd = null) {
        if (!this.synth) {
            alert('이 브라우저는 음성 합성(TTS) 기능을 지원하지 않습니다.');
            return;
        }

        // 기존 읽기 중지
        this.stopSpeaking();

        // 특수문자 및 마크다운 기호 제거
        const cleanText = text.replace(/[*📌💡🔍📅#-]/g, '').trim();
        if (!cleanText) return;

        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.lang = 'ko-KR';
        utterance.rate = 1.0;
        utterance.pitch = 1.0;

        utterance.onstart = () => {
            if (onStart) onStart();
        };

        utterance.onend = () => {
            if (onEnd) onEnd();
        };

        utterance.onerror = () => {
            if (onEnd) onEnd();
        };

        this.synth.speak(utterance);
    }

    stopSpeaking() {
        if (this.synth) {
            this.synth.cancel();
        }
    }

    isSpeaking() {
        return this.synth ? this.synth.speaking : false;
    }
}

window.qaAssistant = new LifeLogQAAssistant();

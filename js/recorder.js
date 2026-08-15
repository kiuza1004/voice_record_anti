/**
 * AutoRecorder Engine - 1시간 단위 자동 녹음 및 카테고리화 보관 컨트롤러
 */
class HourlyAutoRecorder {
    constructor() {
        this.isRecording = false;
        this.intervalSeconds = 3600; // 기본 1시간 (3600초)
        this.elapsedSeconds = 0;
        this.timerId = null;
        
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.startTime = null;

        // UI 콜백
        this.onTick = null;
        this.onStatusChange = null;
        this.onLogSaved = null;
    }

    setIntervalSeconds(sec) {
        this.intervalSeconds = parseInt(sec, 10) || 3600;
    }

    async startAutoRecording() {
        if (this.isRecording) return;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.mediaRecorder = new MediaRecorder(stream);
            this.audioChunks = [];

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };

            this.mediaRecorder.start();
            this.isRecording = true;
            this.startTime = new Date();
            this.elapsedSeconds = 0;

            // STT 실시간 모니터링 시작
            window.sttSummarizer.startListening((liveText) => {
                const liveBox = document.getElementById('live-transcript');
                if (liveBox) {
                    liveBox.innerText = liveText || '말소리를 감지하는 중입니다...';
                }
            });

            // 타이머 루프 시작
            this.timerId = setInterval(() => this.tick(), 1000);

            if (this.onStatusChange) this.onStatusChange(true);

            return true;
        } catch (err) {
            console.error('마이크 접근 권한 실패:', err);
            alert('마이크 접근 권한이 필요합니다. 브라우저 설정에서 마이크를 허용해주세요.');
            return false;
        }
    }

    async tick() {
        this.elapsedSeconds++;

        if (this.onTick) {
            const remaining = this.intervalSeconds - this.elapsedSeconds;
            const progress = (this.elapsedSeconds / this.intervalSeconds) * 100;
            this.onTick(this.elapsedSeconds, remaining, progress);
        }

        // 지정한 시간 주기(예: 1시간)가 지나면 정돈 및 자동 재시작
        if (this.elapsedSeconds >= this.intervalSeconds) {
            await this.processAndSaveCurrentSlot();
        }
    }

    async processAndSaveCurrentSlot() {
        const endTime = new Date();
        const startTime = this.startTime || new Date(endTime.getTime() - (this.intervalSeconds * 1000));

        // STT 텍스트 가져오기 및 중지 후 재생성
        const rawText = window.sttSummarizer.getBufferedText();
        
        // 오디오 블롭 생성
        let audioBlob = null;
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
            audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        }

        // 날짜 포맷 (YYYY-MM-DD)
        const dateString = startTime.toISOString().split('T')[0];
        
        // 시간대 포맷 (HH:MM - HH:MM)
        const formatTime = (d) => d.toTimeString().substring(0, 5);
        const timeRange = `${formatTime(startTime)} ~ ${formatTime(endTime)}`;

        // 200자 이내 요약 생성
        const summary = await window.sttSummarizer.summarizeText(rawText);

        // IndexedDB 보관
        await window.lifeLogStorage.addLogEntry({
            dateString,
            timeRange,
            rawText: rawText || "소리 녹음 데이터",
            summary,
            audioBlob
        });

        if (this.onLogSaved) {
            this.onLogSaved({ dateString, timeRange, summary });
        }

        // 계속해서 다음 1시간 자동 녹음 연속 진행
        if (this.isRecording) {
            this.elapsedSeconds = 0;
            this.startTime = new Date();
            this.audioChunks = [];
            
            // MediaRecorder 및 STT 재시작
            if (this.mediaRecorder && this.mediaRecorder.stream) {
                this.mediaRecorder = new MediaRecorder(this.mediaRecorder.stream);
                this.mediaRecorder.ondataavailable = (event) => {
                    if (event.data.size > 0) this.audioChunks.push(event.data);
                };
                this.mediaRecorder.start();
            }

            window.sttSummarizer.startListening((liveText) => {
                const liveBox = document.getElementById('live-transcript');
                if (liveBox) liveBox.innerText = liveText;
            });
        }
    }

    async stopAutoRecording() {
        if (!this.isRecording) return;

        this.isRecording = false;
        clearInterval(this.timerId);
        this.timerId = null;

        // 현재 시점까지의 녹음 저장
        await this.processAndSaveCurrentSlot();

        // 마이크 트랙 정지
        if (this.mediaRecorder && this.mediaRecorder.stream) {
            this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }

        window.sttSummarizer.stopListening();

        if (this.onStatusChange) this.onStatusChange(false);
    }
}

window.hourlyAutoRecorder = new HourlyAutoRecorder();

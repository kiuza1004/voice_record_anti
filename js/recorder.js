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

            // STT 백그라운드 모니터링 시작 (중간 실시간 변환 없이 녹음 종료 후 일괄 출력)
            window.sttSummarizer.startListening();
            const liveBox = document.getElementById('live-transcript');
            if (liveBox) {
                liveBox.innerHTML = '<p class="placeholder-text" style="color: #3b82f6;"><i class="fa-solid fa-microphone-lines pulse-icon"></i> 음성 녹음 진행 중입니다... (녹음 종료 후 텍스트로 한꺼번에 변환됩니다)</p>';
            }

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

        // STT 전체 텍스트 일괄 획득 (비동기로 마지막 버퍼 수집이 완료될 때까지 완벽 대기)
        const rawText = await window.sttSummarizer.stopListening();
        
        // 녹음 완료 시점에 최종 전체 텍스트를 화면에 출력
        const liveBox = document.getElementById('live-transcript');
        if (liveBox) {
            liveBox.innerText = rawText ? `[녹음 완료 한꺼번에 변환된 텍스트]\n${rawText}` : '녹음된 텍스트가 없습니다.';
        }
        
        // 오디오 블롭 생성 (onstop 비동기 이벤트 대기하여 데이터 유실 방지)
        let audioBlob = null;
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            audioBlob = await new Promise((resolve) => {
                this.mediaRecorder.onstop = () => {
                    const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
                    resolve(blob);
                };
                this.mediaRecorder.stop();
            });
        } else if (this.audioChunks.length > 0) {
            audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        }

        // 날짜 포맷 (로컬 현지 시각 YYYY-MM-DD - 타임존 오류 방지)
        const year = startTime.getFullYear();
        const month = String(startTime.getMonth() + 1).padStart(2, '0');
        const day = String(startTime.getDate()).padStart(2, '0');
        const dateString = `${year}-${month}-${day}`;
        
        // 시간대 포맷 (HH:MM - HH:MM)
        const formatTime = (d) => d.toTimeString().substring(0, 5);
        const timeRange = `${formatTime(startTime)} ~ ${formatTime(endTime)}`;

        // 200자 이내 요약 생성 (오디오 보관 여부 함께 전달)
        const hasAudio = !!(audioBlob && audioBlob.size > 0);
        const summary = await window.sttSummarizer.summarizeText(rawText, hasAudio);

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

            window.sttSummarizer.startListening();
        }
    }

    async stopAutoRecording() {
        if (!this.isRecording) return;

        this.isRecording = false;
        clearInterval(this.timerId);
        this.timerId = null;

        // 현재 시점까지의 녹음 저장 (내부에서 STT stopListening 및 오디오 저장 모두 처리)
        await this.processAndSaveCurrentSlot();

        // 마이크 트랙 정지
        if (this.mediaRecorder && this.mediaRecorder.stream) {
            this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }

        if (this.onStatusChange) this.onStatusChange(false);
    }
}

window.hourlyAutoRecorder = new HourlyAutoRecorder();

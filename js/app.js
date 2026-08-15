/**
 * Main Application Logic
 */
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Storage 초기화
    await window.lifeLogStorage.init();

    // 2. DOM 엘리먼트 획득
    const tabButtons = document.querySelectorAll('.nav-item');
    const tabPages = document.querySelectorAll('.tab-page');

    const btnStartAuto = document.getElementById('btn-start-auto');
    const btnStopAuto = document.getElementById('btn-stop-auto');
    const intervalSelect = document.getElementById('interval-select');
    const recStatusBadge = document.getElementById('rec-status-badge');
    const timerText = document.getElementById('timer-text');
    const timerProgress = document.getElementById('timer-progress');
    const pulseIcon = document.querySelector('.pulse-icon');

    const historyListContainer = document.getElementById('history-list-container');
    const totalDaysCount = document.getElementById('total-days-count');
    const historyDatePicker = document.getElementById('history-date-picker');
    const btnResetFilter = document.getElementById('btn-reset-filter');

    const qaInput = document.getElementById('qa-input');
    const btnQaAsk = document.getElementById('btn-qa-ask');
    const btnQaMic = document.getElementById('btn-qa-mic');
    const qaAnswerContainer = document.getElementById('qa-answer-container');
    const qaAnswerText = document.getElementById('qa-answer-text');
    const btnSpeakAnswer = document.getElementById('btn-speak-answer');

    const geminiApiKeyInput = document.getElementById('gemini-api-key');
    const btnSaveKey = document.getElementById('btn-save-key');
    const btnExportData = document.getElementById('btn-export-data');
    const btnClearData = document.getElementById('btn-clear-data');

    let currentAnswerText = '';

    // API Key 초기 셋팅
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) geminiApiKeyInput.value = savedKey;

    // --- 탭 전환 로직 ---
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.getAttribute('data-tab');

            tabButtons.forEach(b => b.classList.remove('active'));
            tabPages.forEach(p => p.classList.remove('active'));

            btn.classList.add('active');
            document.getElementById(tabId).classList.add('active');

            if (tabId === 'tab-history') {
                renderHistoryList();
            }
        });
    });

    // --- 자동 녹음 제어 연동 ---
    intervalSelect.addEventListener('change', (e) => {
        window.hourlyAutoRecorder.setIntervalSeconds(e.target.value);
    });

    btnStartAuto.addEventListener('click', async () => {
        const intervalVal = intervalSelect.value;
        window.hourlyAutoRecorder.setIntervalSeconds(intervalVal);
        
        const success = await window.hourlyAutoRecorder.startAutoRecording();
        if (success) {
            btnStartAuto.disabled = true;
            btnStopAuto.disabled = false;
            intervalSelect.disabled = true;
            recStatusBadge.innerText = '1시간 자동 녹음 진행 중';
            recStatusBadge.className = 'badge badge-recording';
            pulseIcon.classList.add('recording');
        }
    });

    btnStopAuto.addEventListener('click', async () => {
        await window.hourlyAutoRecorder.stopAutoRecording();
        btnStartAuto.disabled = false;
        btnStopAuto.disabled = true;
        intervalSelect.disabled = false;
        recStatusBadge.innerText = '녹음 대기 중';
        recStatusBadge.className = 'badge badge-idle';
        pulseIcon.classList.remove('recording');
        timerText.innerText = '00:00:00';
        timerProgress.style.width = '0%';
        renderHistoryList();
    });

    // 타이머 콜백
    window.hourlyAutoRecorder.onTick = (elapsedSec, remainingSec, progress) => {
        const h = Math.floor(remainingSec / 3600).toString().padStart(2, '0');
        const m = Math.floor((remainingSec % 3600) / 60).toString().padStart(2, '0');
        const s = (remainingSec % 60).toString().padStart(2, '0');
        timerText.innerText = `${h}:${m}:${s}`;
        timerProgress.style.width = `${progress}%`;
    };

    window.hourlyAutoRecorder.onLogSaved = (logData) => {
        console.log('새로운 녹음 및 200자 요약 보관 완료:', logData);
        renderHistoryList();
    };

    // --- 일자별 카테고리 렌더링 ---
    async function renderHistoryList(filterDate = null) {
        const groupedLogs = await window.lifeLogStorage.getGroupedByDate();
        const dateKeys = Object.keys(groupedLogs).sort().reverse();

        totalDaysCount.innerText = `총 ${dateKeys.length}일 기록`;
        historyListContainer.innerHTML = '';

        if (dateKeys.length === 0) {
            historyListContainer.innerHTML = `
                <div class="card" style="text-align: center; color: #64748b; padding: 30px;">
                    <i class="fa-solid fa-folder-open" style="font-size: 2rem; margin-bottom: 8px;"></i>
                    <p>아직 저장된 일자별 카테고리 기록이 없습니다.</p>
                </div>
            `;
            return;
        }

        dateKeys.forEach((dateStr, index) => {
            if (filterDate && dateStr !== filterDate) return;

            const dayLogs = groupedLogs[dateStr];
            const dayCard = document.createElement('div');
            dayCard.className = `day-card ${index === 0 ? 'open' : ''}`;

            let timeSlotsHtml = '';
            dayLogs.forEach(slot => {
                let audioBtnHtml = '';
                if (slot.audioBlob && slot.audioBlob.size > 0) {
                    const audioUrl = URL.createObjectURL(slot.audioBlob);
                    audioBtnHtml = `
                        <div class="slot-audio-controls">
                            <button class="btn-play-audio" onclick="playAudio('${audioUrl}', this)">
                                <i class="fa-solid fa-play"></i>
                            </button>
                            <span style="font-size: 0.75rem; color: #94a3b8;">오디오 들어보기</span>
                        </div>
                    `;
                }

                timeSlotsHtml += `
                    <div class="time-slot-item">
                        <div class="slot-header">
                            <span class="slot-time"><i class="fa-regular fa-clock"></i> ${slot.timeRange}</span>
                            <span style="font-size: 0.7rem; color: #64748b;">(200자 요약)</span>
                        </div>
                        <div class="slot-summary">${escapeHtml(slot.summary)}</div>
                        ${audioBtnHtml}
                    </div>
                `;
            });

            dayCard.innerHTML = `
                <div class="day-header" onclick="toggleDayCard(this)">
                    <div class="day-title">
                        <i class="fa-solid fa-folder"></i>
                        <span>${dateStr}</span>
                    </div>
                    <span class="day-count">${dayLogs.length}개 시간대 요약</span>
                </div>
                <div class="time-slot-list">
                    ${timeSlotsHtml}
                </div>
            `;

            historyListContainer.appendChild(dayCard);
        });
    }

    // 날짜 필터 이벤트
    historyDatePicker.addEventListener('change', (e) => {
        renderHistoryList(e.target.value);
    });

    btnResetFilter.addEventListener('click', () => {
        historyDatePicker.value = '';
        renderHistoryList();
    });

    // --- Q&A 및 검색 / TTS ---
    btnQaAsk.addEventListener('click', async () => {
        const query = qaInput.value;
        if (!query.trim()) return;

        // 기존 말하기 중지
        if (window.qaAssistant.isSpeaking()) {
            window.qaAssistant.stopSpeaking();
            resetTtsButton();
        }

        const result = await window.qaAssistant.searchAndAnswer(query);
        currentAnswerText = result.answer;

        qaAnswerText.innerHTML = result.answer.replace(/\n/g, '<br>');
        qaAnswerContainer.style.display = 'block';
    });

    qaInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') btnQaAsk.click();
    });

    // TTS 음성 설명 (시작 / 종료 토글 지원)
    btnSpeakAnswer.addEventListener('click', () => {
        if (!currentAnswerText) return;

        if (window.qaAssistant.isSpeaking()) {
            window.qaAssistant.stopSpeaking();
            resetTtsButton();
        } else {
            window.qaAssistant.speak(
                currentAnswerText,
                () => {
                    // 말하기 시작 시 버튼 UI 변경 (종료 버튼)
                    btnSpeakAnswer.innerHTML = '<i class="fa-solid fa-square"></i> 말하기 중지';
                    btnSpeakAnswer.style.backgroundColor = '#ef4444';
                    btnSpeakAnswer.style.borderColor = '#ef4444';
                },
                () => {
                    // 말하기 완료 또는 오류 시 원복
                    resetTtsButton();
                }
            );
        }
    });

    function resetTtsButton() {
        btnSpeakAnswer.innerHTML = '<i class="fa-solid fa-volume-high"></i> 말로 설명 듣기 (TTS)';
        btnSpeakAnswer.style.backgroundColor = '';
        btnSpeakAnswer.style.borderColor = '';
    }

    btnQaMic.addEventListener('click', () => {
        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            const rec = new SpeechRecognition();
            rec.lang = 'ko-KR';
            rec.start();
            btnQaMic.style.color = '#ef4444';
            rec.onresult = (e) => {
                qaInput.value = e.results[0][0].transcript;
                btnQaMic.style.color = '';
                btnQaAsk.click();
            };
            rec.onerror = () => { btnQaMic.style.color = ''; };
        } else {
            alert('음성 입력을 지원하지 않는 브라우저입니다.');
        }
    });

    // --- 설정 이벤트 ---
    btnSaveKey.addEventListener('click', () => {
        const key = geminiApiKeyInput.value.trim();
        localStorage.setItem('gemini_api_key', key);
        alert('Gemini API 키가 저장되었습니다.');
    });

    btnExportData.addEventListener('click', async () => {
        const logs = await window.lifeLogStorage.getAllLogs();
        const exportData = logs.map(l => ({
            dateString: l.dateString,
            timeRange: l.timeRange,
            summary: l.summary,
            rawText: l.rawText,
            timestamp: l.timestamp
        }));

        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", `lifelog_backup_${new Date().toISOString().split('T')[0]}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
    });

    btnClearData.addEventListener('click', async () => {
        if (confirm('정말로 모든 일상 녹음 및 요약 기록을 삭제하시겠습니까?')) {
            await window.lifeLogStorage.clearAllLogs();
            renderHistoryList();
            alert('모든 기록이 삭제되었습니다.');
        }
    });

    // 글로벌 헬퍼 함수 등록
    window.toggleDayCard = function(headerElem) {
        const dayCard = headerElem.parentElement;
        dayCard.classList.toggle('open');
    };

    let activeAudio = null;
    let activeAudioBtn = null;

    window.playAudio = function(url, btnElem) {
        // 이미 다른 오디오가 재생 중이면 중지
        if (activeAudio) {
            activeAudio.pause();
            if (activeAudioBtn) {
                activeAudioBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
            }
            if (activeAudioBtn === btnElem) {
                activeAudio = null;
                activeAudioBtn = null;
                return;
            }
        }

        const audio = new Audio(url);
        activeAudio = audio;
        activeAudioBtn = btnElem;

        if (btnElem) {
            btnElem.innerHTML = '<i class="fa-solid fa-pause"></i>';
        }

        audio.play().catch(err => {
            console.error('오디오 재생 실패:', err);
            alert('오디오를 재생하는 데 실패했습니다. 오디오 브라우저 호환성을 확인해 주세요.');
            if (btnElem) btnElem.innerHTML = '<i class="fa-solid fa-play"></i>';
            activeAudio = null;
            activeAudioBtn = null;
        });

        audio.onended = () => {
            if (btnElem) btnElem.innerHTML = '<i class="fa-solid fa-play"></i>';
            activeAudio = null;
            activeAudioBtn = null;
        };
    };

    window.setQuickQuery = function(text) {
        qaInput.value = text;
        btnQaAsk.click();
    };

    function escapeHtml(text) {
        return text.replace(/[&<>"']/g, function(m) {
            return {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#039;'
            }[m];
        });
    }

    // 초기 히스토리 렌더링
    renderHistoryList();
});

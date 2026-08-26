/**
 * StorageManager - IndexedDB 기반 데이터 저장 및 관리자
 * 일자별 / 시간대별 녹음 내역과 200자 요약 보관
 */
class LifeLogStorage {
    constructor() {
        this.dbName = 'LifeLogDB';
        this.dbVersion = 1;
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('logs')) {
                    const store = db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
                    store.createIndex('dateString', 'dateString', { unique: false });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onerror = (event) => {
                console.error('IndexedDB init error:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    // 새로운 시간대 기록 저장 (일자별 카테고리화 용도)
    async addLogEntry({ dateString, timeRange, rawText, summary, audioBlob = null }) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('logs', 'readwrite');
            const store = tx.objectStore('logs');

            const item = {
                dateString, // YYYY-MM-DD
                timeRange,  // HH:MM - HH:MM
                rawText,
                summary: summary.substring(0, 200), // 200자 이내 보장
                audioBlob,
                isFavorite: false,
                timestamp: Date.now()
            };

            const request = store.add(item);
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    // 즐겨찾기 상태 토글 기능
    async toggleFavorite(id) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('logs', 'readwrite');
            const store = tx.objectStore('logs');
            const getReq = store.get(id);

            getReq.onsuccess = () => {
                const item = getReq.result;
                if (!item) {
                    reject('Item not found');
                    return;
                }
                item.isFavorite = !item.isFavorite;
                const updateReq = store.put(item);
                updateReq.onsuccess = () => resolve(item.isFavorite);
                updateReq.onerror = (e) => reject(e.target.error);
            };
            getReq.onerror = (e) => reject(e.target.error);
        });
    }

    // 모든 로그 가져오기
    async getAllLogs() {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('logs', 'readonly');
            const store = tx.objectStore('logs');
            const request = store.getAll();

            request.onsuccess = () => {
                const logs = request.result || [];
                // 최신순 정렬
                logs.sort((a, b) => b.timestamp - a.timestamp);
                resolve(logs);
            };
            request.onerror = (e) => reject(e.target.error);
        });
    }

    // 일자별 그룹화 데이터 가져오기 { "2026-08-10": [item1, item2], "2026-08-09": [...] }
    async getGroupedByDate() {
        const logs = await this.getAllLogs();
        const grouped = {};

        logs.forEach(log => {
            if (!grouped[log.dateString]) {
                grouped[log.dateString] = [];
            }
            grouped[log.dateString].push(log);
        });

        return grouped;
    }

    // 데이터 삭제 및 초기화
    async clearAllLogs() {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('logs', 'readwrite');
            const store = tx.objectStore('logs');
            const request = store.clear();

            request.onsuccess = () => resolve(true);
            request.onerror = (e) => reject(e.target.error);
        });
    }
}

window.lifeLogStorage = new LifeLogStorage();

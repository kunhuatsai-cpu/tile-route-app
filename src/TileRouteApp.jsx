import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
    Camera,
    Navigation,
    Plus,
    Trash2,
    Clock,
    Edit2,
    X,
    MapPin,
    CheckCircle,
    Circle,
    SaveAll,
    AlertTriangle,
    ScanLine,
    Loader2
} from 'lucide-react';
import logo from './assets/logo.jpg';

// ─────────────────────────────────────────────────
// 常數
// ─────────────────────────────────────────────────
const GOOGLE_MAPS_KEY = "AIzaSyCpxGiyfgmY_jaF27zm_HLfkERPh78zyrQ";
const GEMINI_KEY = "AIzaSyCpxGiyfgmY_jaF27zm_HLfkERPh78zyrQ";
const LIBRARIES = ['places'];
const LS_KEY = 'tilepark_route_stops_v1';
const MAPS_WAYPOINT_LIMIT = 9;

const INITIAL_STOP = {
    id: 'start',
    address: '新北市板橋區金門街215巷78-5號',
    type: 'start',
    name: 'TilePark 本社',
    note: '出發前確認庫存單據',
    completed: false,
};

// ─────────────────────────────────────────────────
// Custom Hook：載入 Google Maps Script
// ─────────────────────────────────────────────────
const useGoogleMapsLoader = ({ googleMapsApiKey, libraries }) => {
    const [isLoaded, setIsLoaded] = useState(false);

    useEffect(() => {
        if (window.google?.maps) { setIsLoaded(true); return; }

        const scriptId = 'google-maps-script';
        if (document.getElementById(scriptId)) {
            const check = setInterval(() => {
                if (window.google?.maps) { setIsLoaded(true); clearInterval(check); }
            }, 100);
            return () => clearInterval(check);
        }

        const script = document.createElement('script');
        script.id = scriptId;
        script.src = `https://maps.googleapis.com/maps/api/js?key=${googleMapsApiKey}&libraries=${libraries.join(',')}`;
        script.async = true;
        script.defer = true;
        script.onload = () => setIsLoaded(true);
        script.onerror = () => console.error('Google Maps 載入失敗');
        document.body.appendChild(script);
    }, [googleMapsApiKey, libraries]);

    return { isLoaded };
};

// ─────────────────────────────────────────────────
// LocalStorage 工具
// ─────────────────────────────────────────────────
const loadFromLS = () => {
    try { const r = localStorage.getItem(LS_KEY); if (r) return JSON.parse(r); }
    catch { /* ignore */ }
    return null;
};
const saveToLS = (stops) => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(stops)); }
    catch { /* ignore */ }
};

// ─────────────────────────────────────────────────
// 主元件
// ─────────────────────────────────────────────────
export default function TileRouteApp() {

    // ── State ────────────────────────────────────
    const [stops, setStops] = useState(() => {
        const saved = loadFromLS();
        return saved?.length > 0 ? saved : [INITIAL_STOP];
    });
    const [departureTime, setDepartureTime] = useState('08:30');

    // OCR 狀態：'idle' | 'processing' | 'confirm'
    const [ocrState, setOcrState] = useState('idle');
    const [ocrCandidates, setOcrCandidates] = useState([]);

    const [isOptimizing, setIsOptimizing] = useState(false);

    // 編輯 Modal
    const [editingStop, setEditingStop] = useState(null);
    const [editName, setEditName] = useState('');
    const [editNote, setEditNote] = useState('');

    // Toast
    const [toast, setToast] = useState(null);

    // ── Refs ─────────────────────────────────────
    const inputRef = useRef(null);
    const autocompleteRef = useRef(null);
    const autocompleteInit = useRef(false);
    const isComposing = useRef(false);
    const fileInputRef = useRef(null);   // 相機/文件選擇
    const imeGuardRef = useRef(null);   // IME Capture Guard listener ref

    // ── Google Maps ───────────────────────────────
    const { isLoaded } = useGoogleMapsLoader({ googleMapsApiKey: GOOGLE_MAPS_KEY, libraries: LIBRARIES });

    // ── Gemini ────────────────────────────────────
    const genAI = useRef(new GoogleGenerativeAI(GEMINI_KEY));

    // ─────────────────────────────────────────────
    // LocalStorage 自動儲存
    // ─────────────────────────────────────────────
    useEffect(() => { saveToLS(stops); }, [stops]);

    // ─────────────────────────────────────────────
    // Google Maps Autocomplete 初始化
    // ─────────────────────────────────────────────
    useEffect(() => {
        if (!isLoaded || !inputRef.current || autocompleteInit.current) return;
        autocompleteInit.current = true;

        autocompleteRef.current = new window.google.maps.places.Autocomplete(
            inputRef.current,
            { fields: ['formatted_address', 'name'], types: [] }
        );

        autocompleteRef.current.addListener('place_changed', () => {
            const place = autocompleteRef.current.getPlace();
            const addr = place.formatted_address || place.name;
            if (addr && inputRef.current) inputRef.current.value = addr;
        });

        // ── 關鍵 IME 修正 ────────────────────────────────────────────────
        // 在 capture 階段攔截 input 事件：
        // 當使用者正在用注音/倉頡組字時 (e.isComposing === true)，
        // 阻止事件傳遞給 Google Maps 的 listener，避免 Autocomplete
        // 在組字過程中發出 Places API 請求並干擾 IME 輸入。
        // ─────────────────────────────────────────────────────────────────
        imeGuardRef.current = (e) => {
            if (e.isComposing) e.stopImmediatePropagation();
        };
        inputRef.current.addEventListener('input', imeGuardRef.current, true);
        inputRef.current.addEventListener('keydown', imeGuardRef.current, true);

        return () => {
            if (window.google && autocompleteRef.current) {
                window.google.maps.event.clearInstanceListeners(autocompleteRef.current);
            }
            if (inputRef.current && imeGuardRef.current) {
                inputRef.current.removeEventListener('input', imeGuardRef.current, true);
                inputRef.current.removeEventListener('keydown', imeGuardRef.current, true);
            }
        };
    }, [isLoaded]);

    // ─────────────────────────────────────────────
    // Toast
    // ─────────────────────────────────────────────
    const showToast = useCallback((msg, type = 'success') => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 2800);
    }, []);

    // ─────────────────────────────────────────────
    // IME 追蹤
    // ─────────────────────────────────────────────
    const handleCompositionStart = () => { isComposing.current = true; };
    const handleCompositionEnd = () => { isComposing.current = false; };
    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !isComposing.current && !e.nativeEvent.isComposing) {
            handleAddStop();
        }
    };

    // ─────────────────────────────────────────────
    // 功能
    // ─────────────────────────────────────────────
    const handleAddStop = () => {
        const address = inputRef.current?.value?.trim();
        if (!address) return;
        const newStop = { id: Date.now(), address, type: 'stop', name: '新規客戶', note: '', completed: false };
        setStops(prev => [...prev, newStop]);
        if (inputRef.current) inputRef.current.value = '';
        setTimeout(() => openEditModal(newStop), 100);
    };

    const handleDeleteStop = (id) => setStops(prev => prev.filter(s => s.id !== id));
    const handleToggleCompleted = (id) => setStops(prev => prev.map(s => s.id === id ? { ...s, completed: !s.completed } : s));

    const openEditModal = (stop) => { setEditingStop(stop); setEditName(stop.name || ''); setEditNote(stop.note || ''); };
    const saveEdit = () => {
        if (!editingStop) return;
        setStops(prev => prev.map(s => s.id === editingStop.id ? { ...s, name: editName, note: editNote } : s));
        setEditingStop(null);
    };

    // ── 真實相機 OCR ────────────────────────────
    const handleStartScan = () => {
        fileInputRef.current?.click();
    };

    const handleFileCapture = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // 重置 file input，讓同一張圖也能再次觸發
        e.target.value = '';

        setOcrState('processing');

        try {
            // 讀取圖片為 base64
            const base64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result.split(',')[1]);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });

            const mimeType = file.type || 'image/jpeg';
            const model = genAI.current.getGenerativeModel({ model: 'gemini-1.5-flash' });

            const prompt = `請仔細閱讀這張送貨單或訂單圖片，從中抽取所有配送資訊。
對每一筆配送記錄，請提取：
1. customer：客戶名稱或公司名稱
2. address：完整的台灣配送地址（縣市區街道門號）
3. note：備註事項，例如貨款金額、指定聯絡人、商品種類、特殊要求等

請只回傳一個 JSON 陣列，每個元素為 { "customer": "", "address": "", "note": "" }。
若某欄位圖片中沒有，設為空字串 ""。不要包含程式碼區塊或任何其他說明文字。

範例輸出格式：
[{"customer":"大倉磁磚","address":"台北市中山區中山北路100號","note":"代收貨款 $3000"}]`;

            const result = await model.generateContent([
                prompt,
                { inlineData: { mimeType, data: base64 } }
            ]);

            const text = result.response.text();
            const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(cleaned);

            if (Array.isArray(parsed) && parsed.length > 0) {
                setOcrCandidates(parsed);
                setOcrState('confirm');
            } else {
                throw new Error('圖片中未識別到配送資訊，請確認圖片清晰且包含送貨單內容');
            }
        } catch (err) {
            console.error('OCR Error:', err);
            const msg = err.message?.includes('JSON') ? '無法解析 AI 回應，請重試' : err.message;
            showToast('識別失敗：' + msg, 'error');
            setOcrState('idle');
        }
    };

    const handleCancelOCR = () => { setOcrState('idle'); setOcrCandidates([]); };

    const handleConfirmOCR = () => {
        const newStops = ocrCandidates.map(item => ({
            id: Date.now() + Math.random(),
            address: item.address || '（地址待確認）',
            type: 'stop',
            name: item.customer || '未知客戶',
            note: item.note || '',
            completed: false,
        }));
        setStops(prev => [...prev, ...newStops]);
        setOcrState('idle');
        setOcrCandidates([]);
        showToast(`✓ 已匯入 ${newStops.length} 個配送站點`);
    };

    // ── AI 路徑最佳化 ────────────────────────────
    const handleAIOptimize = async () => {
        const deliveryStops = stops.filter(s => s.type !== 'start');
        if (deliveryStops.length < 2) { showToast('請至少加入 2 個配送站點', 'warning'); return; }

        setIsOptimizing(true);
        try {
            const startNode = stops.find(s => s.type === 'start');
            const model = genAI.current.getGenerativeModel({ model: 'gemini-1.5-flash' });

            const prompt = `你是台灣物流路線最佳化專家。請將下列配送站點依「從出發點出發、總行車距離最短」的原則重新排序。
所有地址皆在台灣，請根據台灣地理位置（北→中→南 或 縣市相鄰性）判斷。

出發點: ${JSON.stringify({ address: startNode.address, name: startNode.name })}

配送站點（需重排）:
${JSON.stringify(deliveryStops.map(s => ({ id: String(s.id), address: s.address, name: s.name })))}

只回傳 JSON 字串陣列（id 的順序），不含任何其他文字。
範例: ["123","456","789"]`;

            const result = await model.generateContent(prompt);
            const text = result.response.text();
            const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
            const ids = JSON.parse(cleaned);

            if (!Array.isArray(ids)) throw new Error('AI 回應格式錯誤');

            const sorted = [startNode];
            ids.forEach(id => {
                const found = deliveryStops.find(s => String(s.id) === String(id));
                if (found) sorted.push(found);
            });
            deliveryStops.forEach(s => { if (!sorted.find(ns => ns.id === s.id)) sorted.push(s); });

            setStops(sorted);
            showToast('✨ AI 路徑最佳化完成！');
        } catch (err) {
            console.error('AI Optimize Error:', err);
            showToast('最佳化失敗：' + err.message, 'error');
        } finally {
            setIsOptimizing(false);
        }
    };

    // ── Google Maps 匯出 ─────────────────────────
    const handleExportToGoogleMaps = () => {
        if (stops.length < 2) { showToast('請先新增配送站點', 'warning'); return; }
        const delivery = stops.filter(s => s.type !== 'start');
        if (delivery.length > MAPS_WAYPOINT_LIMIT) {
            showToast(`⚠️ Google Maps 免費版限 ${MAPS_WAYPOINT_LIMIT} 個中繼點，已截取前 ${MAPS_WAYPOINT_LIMIT} 個`, 'warning');
        }
        const origin = encodeURIComponent(stops[0].address);
        const destination = encodeURIComponent(stops[stops.length - 1].address);
        const waypoints = stops.slice(1, stops.length - 1).slice(0, MAPS_WAYPOINT_LIMIT)
            .map(s => encodeURIComponent(s.address)).join('|');
        const url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${waypoints ? `&waypoints=${waypoints}` : ''}&travelmode=driving`;
        window.open(url, '_blank');
    };

    // ── LocalStorage 手動儲存 ─────────────────────
    const handleManualSave = () => { saveToLS(stops); showToast('行程已儲存'); };

    // ── 複製純文字 ───────────────────────────────
    const copyToClipboard = () => {
        const text = stops.map((s, i) =>
            `【${i === 0 ? 'START' : String(i).padStart(2, '0')}】${s.name}${s.completed ? ' ✓' : ''}\n📍 ${s.address}\n📝 ${s.note || '-'}`
        ).join('\n\n');
        navigator.clipboard.writeText(text);
        showToast('已複製行程至剪貼簿');
    };

    // ─────────────────────────────────────────────
    // 統計
    // ─────────────────────────────────────────────
    const totalDelivery = stops.filter(s => s.type !== 'start').length;
    const completedCount = stops.filter(s => s.type !== 'start' && s.completed).length;
    const today = new Date().toLocaleDateString('zh-TW', { month: 'long', day: 'numeric', weekday: 'short' });

    // ─────────────────────────────────────────────
    // 渲染
    // ─────────────────────────────────────────────
    return (
        <div className="flex flex-col h-screen bg-zinc-50 text-zinc-800 font-sans max-w-md mx-auto shadow-2xl relative border-x border-zinc-200 overflow-hidden">

            {/* 隱藏的相機 input */}
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleFileCapture}
            />

            {/* ── Header ───────────────────────────── */}
            <header className="bg-white pt-5 pb-3 px-5 border-b border-zinc-100 z-20 flex flex-col items-center relative shrink-0">
                <div className="flex flex-col items-center py-1 select-none">
                    <img src={logo} alt="Tile Park Logo" className="h-14 object-contain" />
                    <p className="text-[10px] text-zinc-400 mt-1 tracking-widest font-serif">{today}</p>
                </div>

                <div className="absolute top-4 right-4 flex items-center bg-zinc-50 border border-zinc-200 rounded-full px-3 py-1">
                    <Clock className="h-3 w-3 text-zinc-400 mr-2" />
                    <input
                        type="time"
                        value={departureTime}
                        onChange={e => setDepartureTime(e.target.value)}
                        className="bg-transparent text-xs font-medium text-zinc-600 outline-none w-16 text-right"
                    />
                </div>

                {totalDelivery > 0 && (
                    <div className="w-full mt-3 px-2">
                        <div className="flex justify-between text-[10px] text-zinc-400 mb-1">
                            <span>配送進度</span>
                            <span>{completedCount} / {totalDelivery} 件完成</span>
                        </div>
                        <div className="w-full h-1 bg-zinc-100 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-red-600 rounded-full transition-all duration-500"
                                style={{ width: `${totalDelivery > 0 ? (completedCount / totalDelivery) * 100 : 0}%` }}
                            />
                        </div>
                    </div>
                )}
            </header>

            {/* ── Main ─────────────────────────────── */}
            <main className="flex-1 overflow-y-auto p-4 pb-36">

                {/* 功能按鈕 */}
                <div className="grid grid-cols-2 gap-3 mb-6">
                    <button
                        onClick={handleStartScan}
                        className="group flex flex-col items-center justify-center p-5 bg-white rounded-xl border border-zinc-200 shadow-sm hover:shadow-md hover:border-red-200 transition-all active:scale-[0.98]"
                    >
                        <div className="w-10 h-10 rounded-full bg-zinc-50 flex items-center justify-center mb-2 group-hover:bg-red-50 transition-colors">
                            <ScanLine className="h-5 w-5 text-zinc-700 group-hover:text-red-600 transition-colors" />
                        </div>
                        <span className="text-sm font-medium">掃描單據</span>
                        <span className="text-[10px] text-zinc-400 mt-0.5 font-serif">AI 智能識別</span>
                    </button>

                    <button
                        onClick={handleManualSave}
                        className="group flex flex-col items-center justify-center p-5 bg-white rounded-xl border border-zinc-200 shadow-sm hover:shadow-md hover:border-zinc-300 transition-all active:scale-[0.98]"
                    >
                        <div className="w-10 h-10 rounded-full bg-zinc-50 flex items-center justify-center mb-2 group-hover:bg-zinc-100 transition-colors">
                            <SaveAll className="h-5 w-5 text-zinc-700" />
                        </div>
                        <span className="text-sm font-medium">儲存行程</span>
                        <span className="text-[10px] text-zinc-400 mt-0.5 font-serif">ルートを保存</span>
                    </button>
                </div>

                {/* 列表標題 + AI 按鈕 */}
                <div className="flex justify-between items-end mb-3 px-1">
                    <div>
                        <h2 className="text-sm font-bold text-zinc-800 tracking-wider uppercase">Delivery List</h2>
                        <p className="text-[10px] text-zinc-400">配送清單 — {stops.length} 件</p>
                    </div>
                    <button
                        onClick={handleAIOptimize}
                        disabled={isOptimizing}
                        className={`flex items-center text-xs text-white transition-all shadow-md px-3 py-1.5 rounded-full ${isOptimizing ? 'bg-zinc-400 cursor-not-allowed' : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:shadow-lg active:scale-95'}`}
                    >
                        {isOptimizing ? (
                            <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />AI 運算中...</>
                        ) : (
                            <><span className="mr-1">✨</span>AI 最佳化</>
                        )}
                    </button>
                </div>

                {/* 時間軸列表 */}
                <div className="space-y-0 relative pl-4">
                    <div className="absolute left-[27px] top-6 bottom-6 w-[1px] bg-zinc-200 -z-10" />

                    {stops.map((stop) => (
                        <div key={stop.id} className="relative py-2.5 group">
                            <div className="flex items-start">
                                <div className={`flex-shrink-0 w-6 h-6 rounded-full border-[3px] z-10 mr-4 flex items-center justify-center bg-white transition-colors
                                    ${stop.type === 'start' ? 'border-zinc-800'
                                        : stop.completed ? 'border-emerald-500'
                                            : 'border-zinc-300 group-hover:border-red-600'}`}
                                >
                                    {stop.type === 'start' && <div className="w-2 h-2 rounded-full bg-zinc-800" />}
                                    {stop.type !== 'start' && stop.completed && <div className="w-2 h-2 rounded-full bg-emerald-500" />}
                                </div>

                                <div className={`flex-1 min-w-0 bg-white p-3.5 rounded-lg border transition-all
                                    ${stop.completed ? 'border-zinc-100 opacity-60'
                                        : stop.type === 'start' ? 'border-zinc-300'
                                            : 'border-zinc-100 shadow-sm hover:shadow-md'}`}
                                >
                                    <div className="flex justify-between items-start mb-1">
                                        <div className="flex-1 min-w-0">
                                            {stop.type === 'start' && (
                                                <span className="text-[10px] bg-zinc-100 text-zinc-500 px-1.5 py-0.5 rounded mb-1 inline-block">START</span>
                                            )}
                                            {stop.completed && stop.type !== 'start' && (
                                                <span className="text-[10px] bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded mb-1 inline-block">✓ 已送達</span>
                                            )}
                                            <h3 className={`font-bold text-sm text-zinc-800 truncate pr-2 ${stop.completed ? 'line-through text-zinc-400' : ''}`}>
                                                {stop.name}
                                            </h3>
                                        </div>
                                        <button
                                            onClick={e => { e.stopPropagation(); openEditModal(stop); }}
                                            className="text-zinc-300 hover:text-zinc-600 p-1 shrink-0"
                                        >
                                            <Edit2 className="h-3.5 w-3.5" />
                                        </button>
                                    </div>

                                    <div className="flex items-start text-xs text-zinc-500 mb-2 leading-relaxed">
                                        <MapPin className="h-3 w-3 mr-1 mt-0.5 shrink-0 opacity-50" />
                                        <span className="break-all">{stop.address}</span>
                                    </div>

                                    {stop.note && (
                                        <div className="pl-3 border-l-2 border-red-200 py-0.5 mb-2">
                                            <p className="text-xs text-zinc-600">{stop.note}</p>
                                        </div>
                                    )}

                                    {stop.type !== 'start' && (
                                        <div className="flex justify-between items-center mt-2 pt-2 border-t border-zinc-50">
                                            <button
                                                onClick={() => handleToggleCompleted(stop.id)}
                                                className={`flex items-center text-[11px] transition-colors ${stop.completed ? 'text-zinc-400 hover:text-zinc-600' : 'text-emerald-600 hover:text-emerald-800'}`}
                                            >
                                                {stop.completed
                                                    ? <><Circle className="h-3.5 w-3.5 mr-1" />復原待送</>
                                                    : <><CheckCircle className="h-3.5 w-3.5 mr-1" />標記送達</>
                                                }
                                            </button>
                                            <button
                                                onClick={() => handleDeleteStop(stop.id)}
                                                className="flex items-center text-[11px] text-red-400 hover:text-red-600 transition-colors"
                                            >
                                                <Trash2 className="h-3 w-3 mr-1" />刪除
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* 地址輸入區 */}
                <div className="mt-6 mb-4">
                    <div className="relative">
                        <input
                            ref={inputRef}
                            type="text"
                            placeholder={isLoaded ? '新增地址 (Google Maps 搜尋)' : '地圖載入中...'}
                            disabled={!isLoaded}
                            className="w-full bg-transparent border-b border-zinc-300 py-3 pl-2 pr-10 text-base focus:outline-none focus:border-zinc-800 transition-colors placeholder:text-zinc-300 rounded-none disabled:opacity-50"
                            autoComplete="off"
                            onCompositionStart={handleCompositionStart}
                            onCompositionEnd={handleCompositionEnd}
                            onKeyDown={handleKeyDown}
                        />
                        <button
                            onClick={handleAddStop}
                            className="absolute right-0 top-2 p-1 text-zinc-400 hover:text-zinc-900 transition-colors"
                        >
                            <Plus className="h-5 w-5" />
                        </button>
                    </div>
                    <p className="text-[10px] text-zinc-300 mt-1 pl-2">輸入地址後按 Enter 或點 + 新增</p>
                </div>
            </main>

            {/* ── 底部按鈕 ─────────────────────── */}
            <div className="absolute bottom-0 left-0 right-0 z-30 bg-gradient-to-t from-zinc-50 via-zinc-50 to-transparent pt-4 pb-6 px-5">
                <button
                    onClick={handleExportToGoogleMaps}
                    className="w-full bg-zinc-900 text-white rounded-lg py-3.5 shadow-xl hover:bg-black transition-all active:scale-[0.99] flex items-center justify-between px-5"
                >
                    <div className="flex flex-col items-start">
                        <span className="text-[10px] text-zinc-400 tracking-widest">NAVIGATION</span>
                        <span className="font-bold text-sm">在 Google Maps 開啟</span>
                    </div>
                    <div className="bg-white/10 p-2 rounded-full">
                        <Navigation className="h-5 w-5" />
                    </div>
                </button>
                <div className="text-center mt-2">
                    <button onClick={copyToClipboard} className="text-[10px] text-zinc-400 hover:text-zinc-600 underline decoration-zinc-200">
                        複製純文字
                    </button>
                </div>
            </div>

            {/* ── 編輯 Modal ────────────────────── */}
            {editingStop && (
                <div className="fixed inset-0 bg-zinc-900/40 backdrop-blur-[2px] z-50 flex items-end sm:items-center justify-center">
                    <div className="bg-white w-full max-w-sm rounded-t-2xl sm:rounded-xl shadow-2xl overflow-hidden border-t-4 border-red-700 relative">
                        <button onClick={() => setEditingStop(null)} className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-800">
                            <X className="h-5 w-5" />
                        </button>
                        <div className="p-7">
                            <h3 className="text-base font-bold text-zinc-900 mb-5 flex items-center">
                                <Edit2 className="h-4 w-4 mr-2 text-red-700" />
                                編輯詳情
                            </h3>
                            <div className="space-y-5">
                                <div className="group">
                                    <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1 group-focus-within:text-red-700 transition-colors">
                                        客戶名稱
                                    </label>
                                    <input
                                        type="text"
                                        value={editName}
                                        onChange={e => setEditName(e.target.value)}
                                        className="w-full border-b border-zinc-200 py-2 text-zinc-800 focus:outline-none focus:border-red-700 transition-colors font-medium"
                                        placeholder="客戶名稱"
                                        autoFocus
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">地址</label>
                                    <div className="text-sm text-zinc-500 py-2 border-b border-zinc-100 leading-relaxed break-all">
                                        {editingStop.address}
                                    </div>
                                </div>
                                <div className="group">
                                    <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1 group-focus-within:text-red-700 transition-colors">
                                        備註
                                    </label>
                                    <textarea
                                        value={editNote}
                                        onChange={e => setEditNote(e.target.value)}
                                        className="w-full bg-zinc-50 rounded p-3 text-sm text-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-200 resize-none h-20"
                                        placeholder="備註事項 (如：代收貨款、聯絡人)..."
                                    />
                                </div>
                            </div>
                            <button
                                onClick={saveEdit}
                                className="w-full bg-zinc-900 text-white font-bold py-3 mt-6 hover:bg-black transition-colors text-sm tracking-widest uppercase rounded"
                            >
                                儲存變更
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── OCR 處理中 (全螢幕) ───────────── */}
            {ocrState === 'processing' && (
                <div className="absolute inset-0 bg-black/80 z-50 flex flex-col items-center justify-center">
                    <Loader2 className="h-10 w-10 text-red-500 animate-spin mb-4" />
                    <p className="text-white font-medium tracking-widest">AI 識別中...</p>
                    <p className="text-white/50 text-xs mt-2">正在分析圖片內容</p>
                </div>
            )}

            {/* ── OCR 確認匯入 Modal ────────────── */}
            {ocrState === 'confirm' && (
                <div className="absolute inset-0 bg-black/60 z-50 flex items-end">
                    <div className="bg-white w-full rounded-t-2xl p-6 max-h-[80vh] flex flex-col">
                        <div className="flex items-center justify-between mb-1">
                            <h3 className="font-bold text-zinc-900">識別結果確認</h3>
                            <button onClick={handleCancelOCR} className="text-zinc-400 hover:text-zinc-700">
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <p className="text-xs text-zinc-500 mb-4">
                            AI 識別到 <span className="font-bold text-zinc-700">{ocrCandidates.length}</span> 筆配送資料，請確認後匯入：
                        </p>

                        <div className="space-y-2 overflow-y-auto flex-1 mb-5">
                            {ocrCandidates.map((item, i) => (
                                <div key={i} className="bg-zinc-50 rounded-lg p-3 border border-zinc-100">
                                    <p className="font-bold text-sm text-zinc-800">{item.customer || '未知客戶'}</p>
                                    <p className="text-xs text-zinc-500 flex items-start mt-1">
                                        <MapPin className="h-3 w-3 mr-1 mt-0.5 shrink-0 text-zinc-400" />
                                        {item.address || '（地址待確認）'}
                                    </p>
                                    {item.note && (
                                        <p className="text-xs text-red-600 mt-1 pl-4">📝 {item.note}</p>
                                    )}
                                </div>
                            ))}
                        </div>

                        <div className="flex gap-3 shrink-0">
                            <button
                                onClick={handleCancelOCR}
                                className="flex-1 py-2.5 border border-zinc-200 rounded-lg text-sm text-zinc-600 hover:bg-zinc-50"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleConfirmOCR}
                                className="flex-1 py-2.5 bg-zinc-900 rounded-lg text-sm text-white font-bold hover:bg-black"
                            >
                                確認匯入 ({ocrCandidates.length} 件)
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Toast 通知 ───────────────────── */}
            {toast && (
                <div className={`fixed bottom-28 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 px-4 py-2.5 rounded-full shadow-lg text-sm font-medium text-white whitespace-nowrap
                    ${toast.type === 'error' ? 'bg-red-600' : toast.type === 'warning' ? 'bg-amber-500' : 'bg-zinc-800'}`}
                >
                    {toast.type === 'warning' && <AlertTriangle className="h-4 w-4 shrink-0" />}
                    {toast.msg}
                </div>
            )}
        </div>
    );
}

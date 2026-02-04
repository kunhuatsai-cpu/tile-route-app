import React, { useState, useRef, useEffect } from 'react';
import { useJsApiLoader } from '@react-google-maps/api';
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
    Camera,
    Navigation,
    Plus,
    Trash2,
    Clock,
    ArrowDownUp,
    Share2,
    Edit2,
    X,
    MapPin
} from 'lucide-react';
import logo from './assets/logo.jpg';

// --- 品牌色票與樣式設定 (TilePark Design System) ---
const THEME = {
    bg: 'bg-zinc-50',           // 背景色：極淺灰 (類似和紙)
    card: 'bg-white',           // 卡片：純白
    textMain: 'text-zinc-800',  // 主文字：深炭灰
    textSub: 'text-zinc-500',   // 次文字：淺灰
    accent: 'bg-red-700',       // 點綴色：TilePark Logo 紅
    primary: 'bg-zinc-800',     // 主按鈕：接近黑色的深灰
    border: 'border-zinc-200',  // 邊框
};

// --- 模擬資料 ---
const MOCK_OCR_RESULTS = [
    { id: 'ocr-1', address: '新北市鶯歌區高職西街118巷42-51號', customer: '棨新陶瓷', note: '馬賽克磚 20箱 - 需回收棧板' },
    { id: 'ocr-2', address: '新竹縣竹北市新溪街18號', customer: '鼎晨磁磚', note: '樣品 5件 - 交給林小姐' },
    { id: 'ocr-3', address: '台中市南屯區大墩十二街122號', customer: '威麟磁藝', note: '特殊規 10箱 - 代收貨款 $5000' },
];

const LIBRARIES = ['places'];
const GOOGLE_API_KEY = "AIzaSyCpxGiyfgmY_jaF27zm_HLfkERPh78zyrQ"; // User provided key

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);

export default function TileRouteApp() {
    const [stops, setStops] = useState([
        { id: 'start', address: '新北市板橋區金門街215巷78-5號', type: 'start', name: 'TilePark 本社', note: '出發前確認庫存單據', validated: true },
    ]);
    const [newAddress, setNewAddress] = useState('');
    const [isCameraOpen, setIsCameraOpen] = useState(false);
    const [departureTime, setDepartureTime] = useState('08:30');
    const [processingOCR, setProcessingOCR] = useState(false);
    const [isOptimizing, setIsOptimizing] = useState(false);

    // Google Maps Loader
    const { isLoaded } = useJsApiLoader({
        id: 'google-map-script',
        googleMapsApiKey: GOOGLE_API_KEY,
        libraries: LIBRARIES
    });

};

// 編輯模式
const [editingStop, setEditingStop] = useState(null);
const [editName, setEditName] = useState('');
const [editNote, setEditNote] = useState('');

// --- 功能邏輯 ---

const openEditModal = (stop) => {
    setEditingStop(stop);
    setEditName(stop.name || '');
    setEditNote(stop.note || '');
};

const saveEdit = () => {
    if (!editingStop) return;
    setStops(prev => prev.map(s =>
        s.id === editingStop.id ? { ...s, name: editName, note: editNote } : s
    ));
    setEditingStop(null);
};

const handleSimulateOCR = () => {
    setIsCameraOpen(true);
    setTimeout(() => {
        setProcessingOCR(true);
        setTimeout(() => {
            const newStops = MOCK_OCR_RESULTS.map(item => ({
                id: Date.now() + Math.random(),
                address: item.address,
                type: 'stop',
                name: item.customer,
                note: item.note,
                validated: true
            }));
            setStops(prev => [...prev, ...newStops]);
            setProcessingOCR(false);
            setIsCameraOpen(false);
        }, 1500);
    }, 1000);
};

const handleAddStop = () => {
    if (!newAddress.trim()) return;
    const newId = Date.now();
    const newStop = {
        id: newId,
        address: newAddress,
        type: 'stop',
        name: '新規客戶',
        note: '',
        validated: true
    };
    setStops(prev => [...prev, newStop]);
    setNewAddress('');
    setTimeout(() => openEditModal(newStop), 100);
};

const handleDeleteStop = (id) => {
    setStops(prev => prev.filter(s => s.id !== id));
};

const handleAIOptimize = async () => {
    if (stops.length < 3) {
        alert("請至少加入 2 個目的地以進行排序 (2つ以上の目的地を追加してください)");
        return;
    }

    setIsOptimizing(true);
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const startNode = stops.find(s => s.type === 'start');
        const deliveryStops = stops.filter(s => s.type !== 'start');

        const prompt = `
                You are a logistics route optimization expert.
                I have a start point and a list of delivery stops.
                Please reorder the "delivery stops" to create the most efficient valid driving route starting from the start point.
                
                Start Point: ${JSON.stringify({ id: startNode.id, address: startNode.address, name: startNode.name })}
                
                Delivery Stops (to be reordered): 
                ${JSON.stringify(deliveryStops.map(s => ({ id: s.id, address: s.address, name: s.name, note: s.note })))}

                Consider driving distance and logic.
                Return ONLY a valid JSON array of strings, where each string is the 'id' of the delivery stops in the optimized order.
                Do NOT include the start point in the returned array.
                Do NOT include markdown formatting (like \`\`\`json). Just the raw JSON array.
            `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // Clean up potentially formatted response
        const cleanedText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const optimizedIds = JSON.parse(cleanedText);

        if (Array.isArray(optimizedIds)) {
            const newSortedStops = [startNode];
            optimizedIds.forEach(id => {
                const originalStop = deliveryStops.find(s => s.id === id || String(s.id) === String(id));
                if (originalStop) {
                    newSortedStops.push(originalStop);
                }
            });

            // Append any stops that might have been missed by AI (safety net)
            deliveryStops.forEach(s => {
                if (!newSortedStops.find(ns => ns.id === s.id)) {
                    newSortedStops.push(s);
                }
            });

            setStops(newSortedStops);
            alert('✨ AI 智慧路徑最佳化完成！\n(AIルート最適化が完了しました)');
        } else {
            throw new Error("Invalid AI response format");
        }

    } catch (error) {
        console.error("AI Optimization Error:", error);
        alert("AI 最佳化失敗，請稍後再試。\n(AI最適化に失敗しました: " + error.message + ")");
    } finally {
        setIsOptimizing(false);
    }
};

const handleExportToGoogleMaps = () => {
    if (stops.length < 2) return;
    const origin = encodeURIComponent(stops[0].address);
    const destination = encodeURIComponent(stops[stops.length - 1].address);
    const waypoints = stops.slice(1, stops.length - 1)
        .map(s => encodeURIComponent(s.address))
        .join('|');
    const url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&waypoints=${waypoints}&travelmode=driving`;
    window.open(url, '_blank');
};

const copyToClipboard = () => {
    const text = stops.map((s, i) => `【${i === 0 ? 'START' : String(i).padStart(2, '0')}】${s.name}\n📍 ${s.address}\n📝 ${s.note || '-'}`).join('\n\n');
    navigator.clipboard.writeText(text);
    alert('已複製行程至剪貼簿 (コピーしました)');
};

return (
    <div className={`flex flex-col h-screen ${THEME.bg} text-zinc-800 font-sans max-w-md mx-auto shadow-2xl relative border-x border-zinc-200`}>

        {/* Header: 日式簡約風格 */}
        <header className="bg-white pt-6 pb-4 px-6 border-b border-zinc-100 z-20 flex flex-col items-center relative">
            <div className="flex flex-col items-center py-2 select-none">
                <img src={logo} alt="Tile Park Logo" className="h-16 object-contain" />
            </div>

            {/* 出發時間小工具 */}
            <div className="absolute top-4 right-4 flex items-center bg-zinc-50 border border-zinc-200 rounded-full px-3 py-1">
                <Clock className="h-3 w-3 text-zinc-400 mr-2" />
                <input
                    type="time"
                    value={departureTime}
                    onChange={(e) => setDepartureTime(e.target.value)}
                    className="bg-transparent text-xs font-medium text-zinc-600 outline-none w-16 text-right"
                />
            </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-4 pb-32 scrollbar-hide">

            {/* 功能按鈕區：平面化設計 */}
            <div className="grid grid-cols-2 gap-4 mb-8">
                <button
                    onClick={handleSimulateOCR}
                    className="group flex flex-col items-center justify-center p-6 bg-white rounded-xl border border-zinc-200 shadow-sm hover:shadow-md hover:border-zinc-300 transition-all active:scale-[0.98]"
                >
                    <div className="w-10 h-10 rounded-full bg-zinc-50 flex items-center justify-center mb-3 group-hover:bg-zinc-100 transition-colors">
                        <Camera className="h-5 w-5 text-zinc-700" />
                    </div>
                    <span className="text-sm font-medium tracking-wide">掃描單據</span>
                    <span className="text-[10px] text-zinc-400 mt-1 font-serif">伝票スキャン</span>
                </button>

                <button
                    onClick={() => alert("雲端同步功能 (Cloud Sync) - Firebase 整合中")}
                    className="group flex flex-col items-center justify-center p-6 bg-white rounded-xl border border-zinc-200 shadow-sm hover:shadow-md hover:border-zinc-300 transition-all active:scale-[0.98]"
                >
                    <div className="w-10 h-10 rounded-full bg-zinc-50 flex items-center justify-center mb-3 group-hover:bg-zinc-100 transition-colors">
                        <Share2 className="h-5 w-5 text-zinc-700" />
                    </div>
                    <span className="text-sm font-medium tracking-wide">同步</span>
                    <span className="text-[10px] text-zinc-400 mt-1 font-serif">同期する</span>
                </button>
            </div>

            {/* 列表標題 */}
            <div className="flex justify-between items-end mb-4 px-1">
                <div>
                    <h2 className="text-sm font-bold text-zinc-800 tracking-wider uppercase">Delivery List</h2>
                    <p className="text-[10px] text-zinc-400">配送清單 <span className="font-serif ml-1">(配送リスト)</span> - {stops.length} 件</p>
                </div>

                {/* AI Optimize Button */}
                <button
                    onClick={handleAIOptimize}
                    disabled={isOptimizing}
                    className={`flex items-center text-xs text-white transition-all shadow-md px-3 py-1.5 rounded-full ${isOptimizing ? 'bg-zinc-400 cursor-not-allowed' : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:shadow-lg active:scale-95'}`}
                >
                    {isOptimizing ? (
                        <>
                            <div className="animate-spin h-3 w-3 border-2 border-white/30 border-t-white rounded-full mr-1.5"></div>
                            AI 運算中...
                        </>
                    ) : (
                        <>
                            <span className="mr-1.5">✨</span>
                            AI 最佳化 <span className="text-[10px] opacity-80 ml-1 font-normal">(AI最適化)</span>
                        </>
                    )}
                </button>
            </div>

            {/* 行程時間軸列表 */}
            <div className="space-y-0 relative pl-4">
                {/* 連結線 (Timeline) */}
                <div className="absolute left-[27px] top-6 bottom-6 w-[1px] bg-zinc-200 -z-10"></div>

                {stops.map((stop) => (
                    <div key={stop.id} className="relative py-3 group">
                        <div className="flex items-start">

                            {/* 時間軸節點 */}
                            <div className={`flex-shrink-0 w-6 h-6 rounded-full border-[3px] z-10 mr-4 flex items-center justify-center bg-white 
                    ${stop.type === 'start' ? 'border-zinc-800' : 'border-zinc-300 group-hover:border-red-600 transition-colors'}`}>
                                {stop.type === 'start' && <div className="w-2 h-2 rounded-full bg-zinc-800"></div>}
                            </div>

                            {/* 卡片本體 */}
                            <div className={`flex-1 min-w-0 bg-white p-4 rounded-lg border ${stop.type === 'start' ? 'border-zinc-300 shadow-none' : 'border-zinc-100 shadow-sm'} transition-all hover:shadow-md`}>

                                <div className="flex justify-between items-start mb-1">
                                    <div>
                                        {stop.type === 'start' && <span className="text-[10px] bg-zinc-100 text-zinc-500 px-1.5 py-0.5 rounded mb-1 inline-block">START</span>}
                                        <h3 className="font-bold text-base text-zinc-800 truncate pr-2">{stop.name}</h3>
                                    </div>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); openEditModal(stop); }}
                                        className="text-zinc-300 hover:text-zinc-600 p-1"
                                    >
                                        <Edit2 className="h-4 w-4" />
                                    </button>
                                </div>

                                <div className="flex items-start text-xs text-zinc-500 mb-3 leading-relaxed">
                                    <MapPin className="h-3 w-3 mr-1 mt-0.5 flex-shrink-0 opacity-50" />
                                    {stop.address}
                                </div>

                                {/* 備註區域 */}
                                {stop.note && (
                                    <div className="relative pl-3 border-l-2 border-red-200 py-1">
                                        <p className="text-xs text-zinc-600 font-medium">{stop.note}</p>
                                    </div>
                                )}

                                {stop.type !== 'start' && (
                                    <div className="mt-3 flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button onClick={() => handleDeleteStop(stop.id)} className="text-[10px] text-red-500 hover:underline flex items-center">
                                            <Trash2 className="h-3 w-3 mr-1" /> 刪除 <span className="ml-1 text-red-300">(削除)</span>
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* 手動輸入區 (極簡風格) */}
            <div className="mt-8 mb-4">
                <div className="relative">
                    {isLoaded ? (
                        <input
                            ref={inputRef}
                            type="text"
                            value={newAddress}
                            onChange={(e) => setNewAddress(e.target.value)}
                            placeholder="新增地址 (Google Maps 検索)"
                            className="w-full bg-transparent border-b border-zinc-300 py-3 pl-2 pr-10 text-sm focus:outline-none focus:border-zinc-800 transition-colors placeholder:text-zinc-300"
                            onKeyDown={(e) => e.key === 'Enter' && handleAddStop()}
                        />
                    ) : (
                        <input
                            type="text"
                            value={newAddress}
                            onChange={(e) => setNewAddress(e.target.value)}
                            placeholder="新增地址 (Loading Maps...)"
                            className="w-full bg-transparent border-b border-zinc-300 py-3 pl-2 pr-10 text-sm focus:outline-none focus:border-zinc-800 transition-colors placeholder:text-zinc-300"
                            onKeyDown={(e) => e.key === 'Enter' && handleAddStop()}
                        />
                    )}

                    <button
                        onClick={handleAddStop}
                        className="absolute right-0 top-2 p-1 text-zinc-400 hover:text-zinc-900"
                    >
                        <Plus className="h-5 w-5" />
                    </button>
                </div>
            </div>

        </main>

        {/* 底部導航欄 (Floating Action) */}
        <div className="absolute bottom-6 left-6 right-6 z-30">
            <button
                onClick={handleExportToGoogleMaps}
                className="w-full bg-zinc-900 text-white rounded-lg py-4 shadow-xl shadow-zinc-200 hover:bg-black transition-transform active:scale-[0.99] flex items-center justify-center group"
            >
                <div className="flex flex-col items-start mr-3">
                    <span className="text-[10px] text-zinc-400 tracking-wider">NAVIGATION</span>
                    <span className="font-bold text-sm">在 Google Maps 開啟 <span className="font-normal opacity-70 ml-1 text-xs">(Mapで開く)</span></span>
                </div>
                <div className="bg-white/10 p-2 rounded-full group-hover:bg-white/20 transition-colors">
                    <Navigation className="h-5 w-5" />
                </div>
            </button>

            <div className="text-center mt-3">
                <button onClick={copyToClipboard} className="text-[10px] text-zinc-400 hover:text-zinc-600 underline decoration-zinc-300">
                    複製純文字 <span className="ml-1">(テキストとしてコピー)</span>
                </button>
            </div>
        </div>

        {/* 編輯 Modal (日式風格) */}
        {editingStop && (
            <div className="fixed inset-0 bg-zinc-900/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-6 animate-in fade-in duration-200">
                <div className="bg-white w-full max-w-sm rounded-none shadow-2xl p-0 overflow-hidden relative border-t-4 border-red-700">

                    <button onClick={() => setEditingStop(null)} className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-800">
                        <X className="h-5 w-5" />
                    </button>

                    <div className="p-8">
                        <h3 className="text-lg font-bold text-zinc-900 mb-6 tracking-wide flex items-center">
                            <Edit2 className="h-4 w-4 mr-2 text-red-700" />
                            編輯詳情 <span className="ml-2 text-sm text-zinc-400 font-serif font-normal">(詳細編集)</span>
                        </h3>

                        <div className="space-y-6">
                            <div className="group">
                                <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1 group-focus-within:text-red-700 transition-colors">客戶名稱 (Customer Name)</label>
                                <input
                                    type="text"
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                    className="w-full border-b border-zinc-200 py-2 text-zinc-800 focus:outline-none focus:border-red-700 transition-colors font-medium"
                                    placeholder="客戶名稱"
                                />
                            </div>

                            <div className="group">
                                <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">地址 (Address)</label>
                                <div className="text-sm text-zinc-500 py-2 border-b border-zinc-100 leading-relaxed">
                                    {editingStop.address}
                                </div>
                            </div>

                            <div className="group">
                                <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1 group-focus-within:text-red-700 transition-colors">備註 (Note)</label>
                                <textarea
                                    value={editNote}
                                    onChange={(e) => setEditNote(e.target.value)}
                                    className="w-full bg-zinc-50 rounded p-3 text-sm text-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-200 resize-none h-24"
                                    placeholder="備註事項 (如：代收貨款、聯絡人)..."
                                />
                            </div>
                        </div>

                        <button
                            onClick={saveEdit}
                            className="w-full bg-zinc-900 text-white font-bold py-3 mt-8 hover:bg-black transition-colors text-sm tracking-widest uppercase"
                        >
                            儲存變更 <span className="ml-1 font-normal opacity-70">(保存)</span>
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* 拍照模擬 (保持原樣，僅修改文字風格) */}
        {isCameraOpen && (
            <div className="absolute inset-0 bg-black z-50 flex flex-col items-center justify-center">
                {!processingOCR ? (
                    <>
                        <div className="w-64 h-80 border border-white/30 mb-8 relative">
                            <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-red-500"></div>
                            <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-red-500"></div>
                            <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-red-500"></div>
                            <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-red-500"></div>
                            <div className="absolute inset-0 flex items-center justify-center text-white/50 text-xs tracking-widest">
                                SCANNING...
                            </div>
                        </div>
                        <div className="text-white text-sm font-medium animate-pulse tracking-widest">掃描中 (Scanning)...</div>
                    </>
                ) : (
                    <div className="flex flex-col items-center">
                        <div className="w-10 h-10 border-2 border-white/20 border-t-red-500 rounded-full animate-spin mb-4"></div>
                        <div className="text-white text-sm font-medium tracking-widest">AI 處理中 (Processing)...</div>
                    </div>
                )}
            </div>
        )}

    </div>
);
}

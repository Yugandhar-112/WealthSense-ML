import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import { LayoutDashboard, Plus, FileSpreadsheet, CheckCircle2, Trash2, ArrowDownToLine, ArrowUpFromLine, Sun, Moon, PieChart as PieChartIcon, ArrowRightLeft, UploadCloud, FileDown, CalendarDays } from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

export default function App() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isDarkMode, setIsDarkMode] = useState(true);
  
  const [filterType, setFilterType] = useState('ALL');
  const [filterCategory, setFilterCategory] = useState('ALL');
  const [activeDropdownTxnId, setActiveDropdownTxnId] = useState(null);

  const [desc, setDesc] = useState('');
  const [amt, setAmt] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [time, setTime] = useState(new Date().toTimeString().slice(0, 5));
  const [txnType, setTxnType] = useState('expense');
  const [selectedCategory, setSelectedCategory] = useState('');
  
  const [uploading, setUploading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const [isExporting, setIsExporting] = useState(false);
  const [showPdfMenu, setShowPdfMenu] = useState(false);
  const [pdfCustomMode, setPdfCustomMode] = useState(false);
  const [pdfStart, setPdfStart] = useState('');
  const [pdfEnd, setPdfEnd] = useState(new Date().toISOString().split('T')[0]);
  const [pdfFilterRange, setPdfFilterRange] = useState(null); 

  const fetchTransactions = async () => {
    try {
      const res = await axios.get('http://localhost:5000/api/transactions');
      const sorted = res.data.sort((a, b) => {
        const datetimeA = new Date(`${a.date}T${a.time || '00:00'}`);
        const datetimeB = new Date(`${b.date}T${b.time || '00:00'}`);
        return datetimeB - datetimeA; 
      });
      setTransactions(sorted);
      setLoading(false);
    } catch (err) {
      console.error("Backend fetch error:", err);
      setLoading(false);
    }
  };

  useEffect(() => { fetchTransactions(); }, []);

  useEffect(() => {
    if (isDarkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [isDarkMode]);

  const handleManualEntry = async (e) => {
    e.preventDefault();
    if (!desc || !amt || !date || !time) return;
    try {
      const payload = { description: desc, amount: parseFloat(amt), date: date, time: time, type: txnType.toUpperCase() };
      if (selectedCategory) payload.category = selectedCategory;
      await axios.post('http://localhost:8000/api/ml/single', payload);
      setDesc(''); setAmt(''); setSelectedCategory(''); setTime(new Date().toTimeString().slice(0, 5)); 
      await fetchTransactions();
      setSuccessMsg('Dashboard Updated');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err) { console.error("ML API Error:", err); }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      await axios.post('http://localhost:8000/api/ml/bulk', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      await fetchTransactions();
      setActiveTab('dashboard');
    } catch (err) { console.error("Bulk Upload Error:", err); } 
    finally { setUploading(false); e.target.value = null; }
  };

  const handleDelete = async (transaction_id) => {
    try {
      await axios.delete(`http://localhost:8000/api/ml/delete/${transaction_id}`);
      await fetchTransactions();
    } catch (err) { console.error("Delete Error:", err); }
  };

  const executePDFExport = (startStr, endStr) => {
    setPdfFilterRange({ start: startStr, end: endStr });
    setIsExporting(true);
    setShowPdfMenu(false);
    setPdfCustomMode(false);

    setTimeout(async () => {
      const element = document.getElementById('dashboard-export-node');
      
      // Temporarily force desktop width to prevent mobile layout squishing during export
      const originalWidth = element.style.width;
      element.style.width = '1200px';

      const canvas = await html2canvas(element, { 
        scale: 2, 
        backgroundColor: isDarkMode ? '#020617' : '#f8fafc',
        windowWidth: 1200
      });

      element.style.width = originalWidth;

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      
      // Add a 10mm margin and scale height proportionally to fix visual distortion
      const margin = 10;
      const printWidth = pdfWidth - (margin * 2);
      const printHeight = (canvas.height * printWidth) / canvas.width;
      
      pdf.addImage(imgData, 'PNG', margin, margin, printWidth, printHeight);
      pdf.save(`WealthSense_Report_${startStr}_to_${endStr}.pdf`);
      
      setIsExporting(false);
      setPdfFilterRange(null);
    }, 800); 
  };

  const handleQuickExport = (days) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days);
    executePDFExport(start.toISOString().split('T')[0], end.toISOString().split('T')[0]);
  };

  const baseTransactions = pdfFilterRange 
    ? transactions.filter(t => t.date >= pdfFilterRange.start && t.date <= pdfFilterRange.end)
    : transactions;

  const userTransactions = baseTransactions.filter(t => t.transaction_id && t.transaction_id.length > 8);
  const totalSpending = userTransactions.filter(t => t.type !== 'INCOME').reduce((sum, t) => sum + (t.amount || 0), 0);
  const totalIncome = userTransactions.filter(t => t.type === 'INCOME').reduce((sum, t) => sum + (t.amount || 0), 0);
  const anomalyCount = userTransactions.filter(t => t.is_anomaly).length;

  const categoryData = userTransactions.filter(t => t.type !== 'INCOME').reduce((acc, curr) => {
    const existing = acc.find(item => item.name === curr.category);
    if (existing) existing.value += curr.amount;
    else acc.push({ name: curr.category || 'Other', value: curr.amount });
    return acc;
  }, []);

  const getCategoryColor = (categoryName) => {
    switch (categoryName) {
      case 'Food/Dining': return '#eab308'; 
      case 'Housing/Utilities': return '#3b82f6'; 
      case 'Misc/Anomalous': return '#ef4444'; 
      case 'Investments': return isDarkMode ? '#f8fafc' : '#0f172a'; 
      default: return '#8b5cf6'; 
    }
  };

  const filteredTransactions = userTransactions.filter(t => {
    const typeMatch = filterType === 'ALL' || t.type === filterType;
    const catMatch = filterCategory === 'ALL' || t.category === filterCategory;
    return typeMatch && catMatch;
  });

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return dateStr;
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-200 font-sans transition-colors duration-300 selection:bg-emerald-500/30">
      <nav className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-50 transition-colors duration-300">
        <div className="max-w-7xl mx-auto px-6 lg:px-10">
          <div className="flex flex-col md:flex-row justify-between items-center py-4 gap-4">
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-emerald-500 to-teal-600 dark:from-emerald-400 dark:to-teal-500">
                WealthSense ML
              </h1>
              <button onClick={() => setIsDarkMode(!isDarkMode)} className="p-2 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
                {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
              </button>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setActiveTab('dashboard')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'dashboard' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                <LayoutDashboard size={18} /> Dashboard
              </button>
              <button onClick={() => setActiveTab('manual')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'manual' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                <Plus size={18} /> Log Event
              </button>
              <button onClick={() => setActiveTab('bulk')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'bulk' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                <FileSpreadsheet size={18} /> Import Data
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto p-6 md:p-10">
        {loading ? (
          <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-emerald-500"></div></div>
        ) : (
          <>
            {activeTab === 'dashboard' && (
              <div id="dashboard-export-node" className={`space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 ${isExporting ? 'p-10 bg-slate-50 dark:bg-slate-950 mx-auto' : ''}`}>
                
                {pdfFilterRange && isExporting && (
                  <div className="text-center pb-4 border-b border-slate-200 dark:border-slate-800">
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Financial Intelligence Report</h2>
                    <p className="text-slate-500 dark:text-slate-400">{formatDate(pdfFilterRange.start)} to {formatDate(pdfFilterRange.end)}</p>
                  </div>
                )}

                {userTransactions.length === 0 && !pdfFilterRange ? (
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 rounded-2xl text-center"><p className="text-slate-500 dark:text-slate-400">No personal data logged yet.</p></div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm dark:shadow-xl">
                        <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">Total Spending</p>
                        <p className="text-3xl font-bold text-slate-900 dark:text-white mt-2">₹{totalSpending.toLocaleString('en-IN')}</p>
                      </div>
                      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm dark:shadow-xl">
                        <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">Total Income</p>
                        <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400 mt-2">₹{totalIncome.toLocaleString('en-IN')}</p>
                      </div>
                      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm dark:shadow-xl">
                        <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">Total Logs</p>
                        <p className="text-3xl font-bold text-slate-900 dark:text-white mt-2">{userTransactions.length}</p>
                      </div>
                      <div className="bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/50 p-6 rounded-2xl shadow-sm dark:shadow-xl">
                        <p className="text-rose-400 text-sm font-medium">Anomalies Detected</p>
                        <p className="text-3xl font-bold text-rose-600 dark:text-rose-500 mt-2">{anomalyCount}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      <div className="col-span-1 flex flex-col gap-4">
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm dark:shadow-xl flex flex-col">
                          <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2 flex items-center gap-2"><PieChartIcon className="text-slate-400" size={20}/> Spend Breakdown</h3>
                          
                          <div className="h-52 flex-shrink-0 -my-4">
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie data={categoryData} cx="50%" cy="50%" innerRadius={55} outerRadius={75} paddingAngle={5} dataKey="value" stroke="none" isAnimationActive={!isExporting}>
                                  {categoryData.map((entry, index) => (<Cell key={`cell-${index}`} fill={getCategoryColor(entry.name)} />))}
                                </Pie>
                                {!isExporting && (
                                  <RechartsTooltip 
                                    contentStyle={{ backgroundColor: isDarkMode ? '#0f172a' : '#ffffff', borderColor: isDarkMode ? '#1e293b' : '#e2e8f0', borderRadius: '0.5rem' }} 
                                    itemStyle={{ color: isDarkMode ? '#f8fafc' : '#0f172a', fontWeight: '500' }} 
                                    formatter={(value) => `₹${value.toLocaleString('en-IN')}`}
                                  />
                                )}
                              </PieChart>
                            </ResponsiveContainer>
                          </div>
                          
                          <div className="mt-4 grid grid-cols-2 gap-3 flex-grow content-start">
                            {categoryData.map((category, index) => (
                              <div key={index} className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: getCategoryColor(category.name) }}></div>
                                {/* Conditionally remove truncate during export to prevent html2canvas text squishing */}
                                <span className={`text-xs text-slate-600 dark:text-slate-300 font-medium ${!isExporting ? 'truncate' : 'break-words leading-tight'}`}>{category.name}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {!isExporting && (
                          <div className="relative z-20">
                            <button onClick={() => setShowPdfMenu(!showPdfMenu)} className="w-full bg-slate-800 hover:bg-slate-700 text-white p-4 rounded-2xl shadow-lg font-semibold flex items-center justify-center gap-2 transition-colors border border-slate-700">
                              <FileDown size={20} /> Generate PDF Report
                            </button>
                            
                            {showPdfMenu && (
                              <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl p-2 animate-in fade-in slide-in-from-top-2">
                                {!pdfCustomMode ? (
                                  <div className="flex flex-col gap-1">
                                    <button onClick={() => handleQuickExport(7)} className="text-left px-4 py-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-sm font-medium transition-colors text-slate-700 dark:text-slate-200">Last Week Report</button>
                                    <button onClick={() => handleQuickExport(30)} className="text-left px-4 py-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-sm font-medium transition-colors text-slate-700 dark:text-slate-200">Last Month Report</button>
                                    <button onClick={() => setPdfCustomMode(true)} className="text-left px-4 py-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-sm font-medium transition-colors text-slate-700 dark:text-slate-200 flex items-center justify-between">Custom Date <CalendarDays size={14}/></button>
                                  </div>
                                ) : (
                                  <div className="p-2 space-y-3">
                                    <div>
                                      <label className="text-xs font-semibold text-slate-500 mb-1 block">Start Date</label>
                                      <input type="date" value={pdfStart} onChange={(e)=>setPdfStart(e.target.value)} className="w-full bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md px-2 py-1.5 text-sm dark:text-slate-200 outline-none" />
                                    </div>
                                    <div>
                                      <label className="text-xs font-semibold text-slate-500 mb-1 block">End Date</label>
                                      <input type="date" value={pdfEnd} onChange={(e)=>setPdfEnd(e.target.value)} className="w-full bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md px-2 py-1.5 text-sm dark:text-slate-200 outline-none" />
                                    </div>
                                    <button onClick={() => { if(pdfStart && pdfEnd) executePDFExport(pdfStart, pdfEnd); }} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded-md text-sm font-semibold transition-colors mt-2">Download Data</button>
                                    <button onClick={() => setPdfCustomMode(false)} className="w-full text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 text-xs mt-1">Cancel</button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm dark:shadow-xl col-span-1 lg:col-span-2 flex flex-col">
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2"><ArrowRightLeft className="text-slate-400" size={20}/> Recent Intelligence Pipeline</h3>

                        {!isExporting && (
                          <div className="flex flex-wrap items-center gap-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-3 rounded-xl mb-4 text-xs">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-400">Type:</span>
                              <div className="flex bg-slate-200 dark:bg-slate-900 p-0.5 rounded-md border border-slate-300 dark:border-slate-800">
                                {['ALL', 'EXPENSE', 'INCOME'].map(type => (
                                  <button key={type} onClick={() => setFilterType(type)} className={`px-2 py-1 rounded font-medium transition-colors ${filterType === type ? 'bg-white dark:bg-slate-800 shadow-sm text-slate-900 dark:text-white' : 'text-slate-500'}`}>{type}</button>
                                ))}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-400">Category:</span>
                              <div className="flex flex-wrap bg-slate-200 dark:bg-slate-900 p-0.5 rounded-md border border-slate-300 dark:border-slate-800 gap-0.5">
                                {['ALL', 'Food/Dining', 'Housing/Utilities', 'Investments', 'Misc/Anomalous', 'Income'].map(cat => (
                                  <button key={cat} onClick={() => setFilterCategory(cat)} className={`px-2 py-1 rounded font-medium transition-colors ${filterCategory === cat ? 'bg-white dark:bg-slate-800 shadow-sm text-slate-900 dark:text-white' : 'text-slate-500'}`}>{cat === 'ALL' ? 'ALL' : cat.split('/')[0]}</button>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Force overflow visibility during export to capture all rows and eliminate scrollbar bugs */}
                        <div className={`custom-scrollbar ${!isExporting ? 'overflow-x-auto max-h-[260px] overflow-y-auto' : 'overflow-visible'}`}>
                          <table className="w-full text-left border-collapse table-fixed">
                            <thead className="sticky top-0 bg-white dark:bg-slate-900 z-10">
                              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 text-sm">
                                <th className="pb-3 font-medium w-24">Date</th>
                                <th className="pb-3 font-medium w-20">Time</th>
                                <th className="pb-3 font-medium">Description</th>
                                <th className="pb-3 font-medium w-36">Category</th>
                                <th className="pb-3 text-right font-medium w-24">Amount</th>
                                <th className="pb-3 text-center font-medium w-20">Status</th>
                                {!isExporting && <th className="pb-3 text-right font-medium w-14 pr-5">Action</th>}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50 text-sm">
                              {filteredTransactions.map((t, i) => {
                                const catColor = getCategoryColor(t.category);
                                return (
                                  <tr key={i} className="hover:bg-slate-50 dark:bg-slate-900 transition-colors group">
                                    <td className="py-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">{formatDate(t.date)}</td>
                                    <td className="py-3 text-slate-400 dark:text-slate-500 font-semibold whitespace-nowrap">{t.time || '--:--'}</td>
                                    {/* Strip truncate constraint on export */}
                                    <td className={`py-3 font-mono text-slate-700 dark:text-slate-300 pr-4 ${!isExporting ? 'truncate' : 'break-words leading-tight'}`}>{t.description}</td>
                                    <td className="py-3 relative">
                                      {t.type === 'INCOME' ? (
                                        <span className="px-2 py-1 text-xs font-medium rounded-md border bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800">Income</span>
                                      ) : (
                                        <div className="relative inline-block text-left">
                                          <button 
                                            onClick={(e) => { if(!isExporting){ e.stopPropagation(); setActiveDropdownTxnId(activeDropdownTxnId === t.transaction_id ? null : t.transaction_id); } }}
                                            className={`px-2 py-1 text-xs font-medium rounded-md border max-w-[130px] ${!isExporting ? 'truncate cursor-pointer hover:brightness-110 transition-all block' : 'whitespace-normal text-left inline-block'}`}
                                            style={{ color: catColor, borderColor: `${catColor}40`, backgroundColor: `${catColor}15` }}
                                          >
                                            {t.category}
                                          </button>
                                          
                                          {activeDropdownTxnId === t.transaction_id && !isExporting && (
                                            <div className="absolute left-0 mt-1 w-40 rounded-lg shadow-xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 z-50 py-1">
                                              {["Food/Dining", "Housing/Utilities", "Investments", "Misc/Anomalous"].map((catOption) => (
                                                <button key={catOption} onClick={async (e) => { e.stopPropagation(); try { await axios.put(`http://localhost:8000/api/ml/update/${t.transaction_id}`, { category: catOption }); await fetchTransactions(); } catch (err) { console.error(err); } finally { setActiveDropdownTxnId(null); } }} className="w-full text-left px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">{catOption}</button>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </td>
                                    <td className={`py-3 text-right font-semibold whitespace-nowrap ${t.is_anomaly ? 'text-rose-500 dark:text-rose-400' : (t.type === 'INCOME' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-800 dark:text-slate-200')}`}>
                                      {t.type === 'INCOME' ? '+' : ''}₹{t.amount.toLocaleString('en-IN')}
                                    </td>
                                    <td className="py-3 text-center">
                                      {t.is_anomaly ? <span className="px-2 py-1 text-xs font-bold bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-500 rounded border border-rose-200 dark:border-rose-500/20">REVIEW</span> : <span className="px-2 py-1 text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded border border-slate-200 dark:border-slate-700">NORMAL</span>}
                                    </td>
                                    {!isExporting && (
                                      <td className="py-3 text-right pr-5">
                                        <button onClick={() => handleDelete(t.transaction_id)} className="text-slate-400 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100 inline-flex">
                                          <Trash2 size={16} />
                                        </button>
                                      </td>
                                    )}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {activeTab === 'manual' && (
              <div className="max-w-xl mx-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 rounded-2xl shadow-sm dark:shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-500">
                <h2 className="text-xl font-bold mb-6 flex items-center gap-2 text-slate-900 dark:text-white"><Plus className="text-emerald-500"/> Log Event</h2>
                {successMsg && (<div className="mb-6 p-4 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-lg flex items-center gap-2 text-emerald-600 dark:text-emerald-400"><CheckCircle2 size={20} /><p className="font-medium">{successMsg}</p></div>)}

                <form onSubmit={handleManualEntry} className="space-y-6">
                  <div className="flex bg-slate-100 dark:bg-slate-950 p-1 rounded-lg border border-slate-200 dark:border-slate-800 w-full md:w-fit">
                    <button type="button" onClick={() => { setTxnType('expense'); setSelectedCategory(''); }} className={`flex items-center gap-2 px-6 py-2 rounded-md text-sm font-medium transition-colors ${txnType === 'expense' ? 'bg-white dark:bg-rose-500/20 text-rose-600 dark:text-rose-400 shadow-sm' : 'text-slate-500'}`}><ArrowUpFromLine size={16}/> Expense</button>
                    <button type="button" onClick={() => { setTxnType('income'); setSelectedCategory(''); }} className={`flex items-center gap-2 px-6 py-2 rounded-md text-sm font-medium transition-colors ${txnType === 'income' ? 'bg-white dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 shadow-sm' : 'text-slate-500'}`}><ArrowDownToLine size={16}/> Income</button>
                  </div>
                  <div>
                    <label className="text-sm text-slate-500 dark:text-slate-400 font-semibold mb-1 block">Description</label>
                    <input type="text" value={desc} onChange={e => setDesc(e.target.value)} placeholder="e.g. Swiggy Lunch or Salary" className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-3 text-slate-900 dark:text-slate-200 focus:outline-none focus:border-emerald-500" required/>
                  </div>
                  <div>
                    <label className="text-sm text-slate-500 dark:text-slate-400 font-semibold mb-1 block">Amount (₹)</label>
                    <input type="number" value={amt} onChange={e => setAmt(e.target.value)} placeholder="0.00" min="1" className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-3 text-slate-900 dark:text-slate-200 focus:outline-none focus:border-emerald-500" required/>
                  </div>
                  {txnType === 'expense' && (
                    <div>
                      <label className="text-sm text-slate-500 dark:text-slate-400 font-semibold mb-2 block">Category (Optional)</label>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        {["Food/Dining", "Housing/Utilities", "Investments", "Misc/Anomalous"].map((catOption) => {
                          const isSelected = selectedCategory === catOption;
                          const chipColor = getCategoryColor(catOption);
                          return (
                            <button key={catOption} type="button" onClick={() => setSelectedCategory(isSelected ? '' : catOption)} className="px-2 py-2 text-xs font-semibold rounded-lg border transition-all text-center cursor-pointer" style={{ color: isSelected ? '#ffffff' : chipColor, backgroundColor: isSelected ? chipColor : `${chipColor}10`, borderColor: isSelected ? chipColor : `${chipColor}40` }}>{catOption}</button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm text-slate-500 dark:text-slate-400 font-semibold mb-1 block">Date</label>
                      <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-3 text-slate-900 dark:text-slate-200 focus:outline-none focus:border-emerald-500" required/>
                    </div>
                    <div>
                      <label className="text-sm text-slate-500 dark:text-slate-400 font-semibold mb-1 block">Time</label>
                      <input type="time" value={time} onChange={e => setTime(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-3 text-slate-900 dark:text-slate-200 focus:outline-none focus:border-emerald-500" required/>
                    </div>
                  </div>
                  <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-3 rounded-lg font-medium shadow-md transition-colors mt-4">{txnType === 'income' ? 'Log Income' : 'Analyze & Save Expense'}</button>
                </form>
              </div>
            )}

            {activeTab === 'bulk' && (
              <div className="max-w-xl mx-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 rounded-2xl shadow-sm dark:shadow-xl">
                <h2 className="text-xl font-bold mb-6 flex items-center gap-2 text-slate-900 dark:text-white"><UploadCloud className="text-blue-500"/> Import Bank Statement</h2>
                <div className="relative border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 bg-slate-50 dark:bg-slate-950 rounded-xl p-10 text-center">
                  <input type="file" accept=".csv, .xlsx" onChange={handleFileUpload} disabled={uploading} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-wait" />
                  {uploading ? (
                    <div className="flex flex-col items-center gap-4 text-slate-500 dark:text-slate-400"><div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div><p>Running Machine Learning Pipeline...</p></div>
                  ) : (
                    <div className="flex flex-col items-center gap-4 text-slate-500 dark:text-slate-400"><FileSpreadsheet size={48} className="text-slate-400 dark:text-slate-600" /><div><p className="font-medium text-slate-700 dark:text-slate-200">Click or drag file to upload</p><p className="text-sm mt-1">Supports HDFC/SBI .csv or .xlsx formats</p></div></div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
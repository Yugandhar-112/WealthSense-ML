import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import { Wallet, AlertTriangle, Activity, ArrowRightLeft, Plus, UploadCloud, PieChart as PieChartIcon, LayoutDashboard, FileSpreadsheet, CheckCircle2, Trash2, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';

export default function App() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  
  const [desc, setDesc] = useState('');
  const [amt, setAmt] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [txnType, setTxnType] = useState('expense');
  
  const [uploading, setUploading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const fetchTransactions = async () => {
    try {
      const res = await axios.get('http://localhost:5000/api/transactions');
      const sorted = res.data.sort((a, b) => new Date(b.date) - new Date(a.date));
      setTransactions(sorted);
      setLoading(false);
    } catch (err) {
      console.error("Backend fetch error:", err);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTransactions();
  }, []);

  const handleManualEntry = async (e) => {
    e.preventDefault();
    if (!desc || !amt || !date) return;
    
    try {
      await axios.post('http://localhost:8000/api/ml/single', {
        description: desc,
        amount: parseFloat(amt),
        date: date,
        type: txnType.toUpperCase()
      });
      
      setDesc(''); 
      setAmt(''); 
      
      await fetchTransactions();

      setSuccessMsg('Dashboard Updated');
      setTimeout(() => setSuccessMsg(''), 3000);
      
    } catch (err) {
      console.error("ML API Error:", err);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      await axios.post('http://localhost:8000/api/ml/bulk', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      await fetchTransactions();
      setActiveTab('dashboard');
    } catch (err) {
      console.error("Bulk Upload Error:", err);
    } finally {
      setUploading(false);
      e.target.value = null; 
    }
  };

  const handleDelete = async (transaction_id) => {
    try {
      await axios.delete(`http://localhost:8000/api/ml/delete/${transaction_id}`);
      await fetchTransactions();
    } catch (err) {
      console.error("Delete Error:", err);
    }
  };

  const userTransactions = transactions.filter(t => t.transaction_id && t.transaction_id.length > 8);
  
  const totalSpending = userTransactions.filter(t => t.type !== 'INCOME').reduce((sum, t) => sum + (t.amount || 0), 0);
  const totalIncome = userTransactions.filter(t => t.type === 'INCOME').reduce((sum, t) => sum + (t.amount || 0), 0);
  const anomalyCount = userTransactions.filter(t => t.is_anomaly).length;

  const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899'];
  const categoryData = userTransactions.filter(t => t.type !== 'INCOME').reduce((acc, curr) => {
    const existing = acc.find(item => item.name === curr.category);
    if (existing) existing.value += curr.amount;
    else acc.push({ name: curr.category || 'Other', value: curr.amount });
    return acc;
  }, []);

  // Sync colors: Create a lookup dictionary mapping Category Name to its assigned hex color
  const CATEGORY_COLORS = {};
  categoryData.forEach((cat, index) => {
    CATEGORY_COLORS[cat.name] = COLORS[index % COLORS.length];
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-emerald-500/30">
      <nav className="bg-slate-900 border-b border-slate-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 lg:px-10">
          <div className="flex flex-col md:flex-row justify-between items-center py-4 gap-4">
            <div>
              <h1 className="text-2xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-500">
                WealthSense ML
              </h1>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setActiveTab('dashboard')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'dashboard' ? 'bg-emerald-500/10 text-emerald-400' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}>
                <LayoutDashboard size={18} /> Dashboard
              </button>
              <button onClick={() => setActiveTab('manual')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'manual' ? 'bg-emerald-500/10 text-emerald-400' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}>
                <Plus size={18} /> Log Event
              </button>
              <button onClick={() => setActiveTab('bulk')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'bulk' ? 'bg-emerald-500/10 text-emerald-400' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}>
                <FileSpreadsheet size={18} /> Import Data
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto p-6 md:p-10">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-emerald-500"></div>
          </div>
        ) : (
          <>
            {activeTab === 'dashboard' && (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                {userTransactions.length === 0 && (
                  <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl text-center">
                    <p className="text-slate-400">No personal data logged yet. The ML engine is trained on the hidden dataset. Use the tabs above to log your first expense.</p>
                  </div>
                )}
                
                {userTransactions.length > 0 && (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                      <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl">
                        <p className="text-slate-400 text-sm font-medium">Total Spending</p>
                        <p className="text-3xl font-bold text-white mt-2">₹{totalSpending.toLocaleString('en-IN')}</p>
                      </div>
                      <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl">
                        <p className="text-slate-400 text-sm font-medium">Total Income</p>
                        <p className="text-3xl font-bold text-emerald-400 mt-2">₹{totalIncome.toLocaleString('en-IN')}</p>
                      </div>
                      <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl">
                        <p className="text-slate-400 text-sm font-medium">Total Logs</p>
                        <p className="text-3xl font-bold text-white mt-2">{userTransactions.length}</p>
                      </div>
                      <div className="bg-slate-900 border border-rose-900/50 p-6 rounded-2xl shadow-xl">
                        <p className="text-rose-400 text-sm font-medium">Anomalies Detected</p>
                        <p className="text-3xl font-bold text-rose-500 mt-2">{anomalyCount}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl col-span-1">
                        <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                          <PieChartIcon className="text-slate-400" size={20}/> Spend Breakdown
                        </h3>
                        <div className="h-64">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie data={categoryData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value" stroke="none">
                                {categoryData.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                              </Pie>
                              <RechartsTooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '0.5rem', color: '#f1f5f9' }} itemStyle={{ color: '#e2e8f0' }} formatter={(value) => `₹${value.toLocaleString('en-IN')}`}/>
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl col-span-1 lg:col-span-2">
                        <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                          <ArrowRightLeft className="text-slate-400" size={20}/> Recent Intelligence Pipeline
                        </h3>
                        <div className="overflow-x-auto max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
                          <table className="w-full text-left border-collapse">
                            <thead className="sticky top-0 bg-slate-900 z-10">
                              <tr className="border-b border-slate-800 text-slate-400 text-sm">
                                <th className="pb-3 font-medium">Date</th>
                                <th className="pb-3 font-medium">Description</th>
                                <th className="pb-3 font-medium">Category</th>
                                <th className="pb-3 text-right font-medium">Amount</th>
                                <th className="pb-3 text-center font-medium">Status</th>
                                <th className="pb-3 text-center font-medium">Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/50 text-sm">
                              {userTransactions.map((t, i) => {
                                // Dynamically assign border and text colors from Pie Chart hex codes
                                const catColor = CATEGORY_COLORS[t.category] || '#94a3b8'; // Fallback slate-400
                                
                                return (
                                  <tr key={i} className="hover:bg-slate-800/30 transition-colors group">
                                    <td className="py-3 text-slate-400 whitespace-nowrap">{t.date}</td>
                                    <td className="py-3 font-mono text-slate-300 truncate max-w-[150px]">{t.description}</td>
                                    <td className="py-3">
                                      {t.type === 'INCOME' ? (
                                        <span className="px-2 py-1 text-xs font-medium rounded-md border bg-emerald-950 text-emerald-400 border-emerald-800">
                                          {t.category}
                                        </span>
                                      ) : (
                                        <span 
                                          className="px-2 py-1 text-xs font-medium rounded-md border"
                                          style={{
                                            color: catColor,
                                            borderColor: `${catColor}40`, // 40 = 25% opacity in hex
                                            backgroundColor: `${catColor}15` // 15 = ~8% opacity in hex
                                          }}
                                        >
                                          {t.category}
                                        </span>
                                      )}
                                    </td>
                                    <td className={`py-3 text-right font-semibold whitespace-nowrap ${t.is_anomaly ? 'text-rose-400' : (t.type === 'INCOME' ? 'text-emerald-400' : 'text-slate-200')}`}>
                                      {t.type === 'INCOME' ? '+' : ''}₹{t.amount.toLocaleString('en-IN')}
                                    </td>
                                    <td className="py-3 text-center">
                                      {t.is_anomaly ? (
                                        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-bold bg-rose-500/10 text-rose-500 rounded border border-rose-500/20">REVIEW</span>
                                      ) : (
                                        <span className="px-2 py-1 text-xs font-bold bg-slate-800 text-slate-400 rounded border border-slate-700">NORMAL</span>
                                      )}
                                    </td>
                                    <td className="py-3 text-center">
                                      <button onClick={() => handleDelete(t.transaction_id)} className="text-slate-500 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100">
                                        <Trash2 size={16} />
                                      </button>
                                    </td>
                                  </tr>
                                )
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
              <div className="max-w-xl mx-auto bg-slate-900 border border-slate-800 p-8 rounded-2xl shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-500">
                <h2 className="text-xl font-bold mb-6 flex items-center gap-2"><Plus className="text-emerald-500"/> Log Event</h2>
                
                {successMsg && (
                  <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg flex items-center gap-2 text-emerald-400">
                    <CheckCircle2 size={20} />
                    <p className="font-medium">{successMsg}</p>
                  </div>
                )}

                <form onSubmit={handleManualEntry} className="space-y-6">
                  <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800 w-full md:w-fit">
                    <button type="button" onClick={() => setTxnType('expense')} className={`flex items-center gap-2 px-6 py-2 rounded-md text-sm font-medium transition-colors ${txnType === 'expense' ? 'bg-rose-500/20 text-rose-400' : 'text-slate-500 hover:text-slate-300'}`}>
                      <ArrowUpFromLine size={16}/> Expense
                    </button>
                    <button type="button" onClick={() => setTxnType('income')} className={`flex items-center gap-2 px-6 py-2 rounded-md text-sm font-medium transition-colors ${txnType === 'income' ? 'bg-emerald-500/20 text-emerald-400' : 'text-slate-500 hover:text-slate-300'}`}>
                      <ArrowDownToLine size={16}/> Income
                    </button>
                  </div>

                  <div>
                    <label className="text-sm text-slate-400 font-semibold mb-1 block">Description</label>
                    <input type="text" value={desc} onChange={e => setDesc(e.target.value)} placeholder="e.g. Swiggy Lunch or Salary" className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors" required/>
                  </div>
                  <div>
                    <label className="text-sm text-slate-400 font-semibold mb-1 block">Amount (₹)</label>
                    <input type="number" value={amt} onChange={e => setAmt(e.target.value)} placeholder="0.00" min="1" className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors" required/>
                  </div>
                  <div>
                    <label className="text-sm text-slate-400 font-semibold mb-1 block">Date</label>
                    <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors" required/>
                  </div>
                  <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-3 rounded-lg font-medium transition-colors mt-4">
                    {txnType === 'income' ? 'Log Income' : 'Analyze & Save Expense'}
                  </button>
                </form>
              </div>
            )}

            {activeTab === 'bulk' && (
              <div className="max-w-xl mx-auto bg-slate-900 border border-slate-800 p-8 rounded-2xl shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-500">
                <h2 className="text-xl font-bold mb-6 flex items-center gap-2"><UploadCloud className="text-blue-500"/> Import Bank Statement</h2>
                <div className="relative border-2 border-dashed border-slate-700 hover:border-blue-500 bg-slate-950 rounded-xl p-10 transition-colors text-center">
                  <input type="file" accept=".csv, .xlsx" onChange={handleFileUpload} disabled={uploading} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-wait" />
                  
                  {uploading ? (
                    <div className="flex flex-col items-center gap-4 text-slate-400">
                      <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
                      <p>Running Machine Learning Pipeline...</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-4 text-slate-400">
                      <FileSpreadsheet size={48} className="text-slate-600" />
                      <div>
                        <p className="font-medium text-slate-200">Click or drag file to upload</p>
                        <p className="text-sm mt-1">Supports HDFC/SBI .csv or .xlsx formats</p>
                      </div>
                    </div>
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
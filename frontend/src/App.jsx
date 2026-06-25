import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

export default function App() {
  const [transactions, setTransactions] = useState([]);
  const [stats, setStats] = useState({ totalSpent: 0, anomalies: 0 });

  useEffect(() => {
    axios.get('http://localhost:5000/api/transactions').then(res => setTransactions(res.data));
    axios.get('http://localhost:5000/api/stats').then(res => setStats(res.data));
  }, []);

  const COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#ef4444'];
  
  // Aggregate data for Pie Chart
  const categoryData = transactions.reduce((acc, curr) => {
    const existing = acc.find(item => item.name === curr.category);
    if (existing) existing.value += curr.amount;
    else acc.push({ name: curr.category || 'Other', value: curr.amount });
    return acc;
  }, []);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-8 font-sans">
      <header className="mb-8 border-b border-slate-700 pb-4">
        <h1 className="text-4xl font-bold text-emerald-400">WealthSense ML</h1>
        <p className="text-slate-400 mt-2">AI-Powered Financial Intelligence</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-slate-800 p-6 rounded-xl shadow-lg border border-slate-700">
          <h3 className="text-slate-400 text-sm">Total Tracked Spending</h3>
          <p className="text-3xl font-bold mt-2 text-white">₹{stats.totalSpent.toLocaleString()}</p>
        </div>
        <div className="bg-slate-800 p-6 rounded-xl shadow-lg border border-slate-700">
          <h3 className="text-slate-400 text-sm">Detected Anomalies</h3>
          <p className="text-3xl font-bold mt-2 text-rose-500">{stats.anomalies} Flags</p>
        </div>
        <div className="bg-slate-800 p-6 rounded-xl shadow-lg border border-slate-700">
          <h3 className="text-slate-400 text-sm">Savings Goal Progress</h3>
          <div className="w-full bg-slate-700 rounded-full h-4 mt-4">
            <div className="bg-emerald-500 h-4 rounded-full" style={{ width: '45%' }}></div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-slate-800 p-6 rounded-xl shadow-lg border border-slate-700">
          <h2 className="text-xl font-semibold mb-6 border-b border-slate-700 pb-2">Recent Transactions</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-slate-400 border-b border-slate-700">
                  <th className="pb-3">Description</th>
                  <th className="pb-3">Category</th>
                  <th className="pb-3">Amount</th>
                  <th className="pb-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map(txn => (
                  <tr key={txn.transaction_id} className="border-b border-slate-700/50">
                    <td className="py-3">{txn.description}</td>
                    <td className="py-3"><span className="bg-slate-700 px-2 py-1 rounded text-xs">{txn.category}</span></td>
                    <td className="py-3 font-medium">₹{txn.amount}</td>
                    <td className="py-3">
                      {txn.is_anomaly ? <span className="text-rose-500 font-bold text-xs bg-rose-500/10 px-2 py-1 rounded">REVIEW</span> 
                      : <span className="text-emerald-500 font-bold text-xs bg-emerald-500/10 px-2 py-1 rounded">VERIFIED</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-slate-800 p-6 rounded-xl shadow-lg border border-slate-700">
          <h2 className="text-xl font-semibold mb-6 border-b border-slate-700 pb-2">Spending by Category</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={categoryData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                  {categoryData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#f8fafc' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
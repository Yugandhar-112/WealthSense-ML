const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/wealthsense_db')
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.log(err));

const transactionSchema = new mongoose.Schema({
  transaction_id: String,
  description: String,
  amount: Number,
  date: String,
  category: String,
  is_anomaly: Boolean
});

const Transaction = mongoose.model('Transaction', transactionSchema);

app.get('/api/transactions', async (req, res) => {
  try {
    const transactions = await Transaction.find().sort({ date: -1 });
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const totalSpent = await Transaction.aggregate([{ $group: { _id: null, total: { $sum: "$amount" } } }]);
    const anomalies = await Transaction.countDocuments({ is_anomaly: true });
    res.json({ totalSpent: totalSpent[0]?.total || 0, anomalies });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
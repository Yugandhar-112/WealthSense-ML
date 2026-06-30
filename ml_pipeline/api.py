import torch # Must be imported FIRST on Windows to avoid DLL conflicts

import os
import io
import uuid
from datetime import datetime
import pandas as pd
import numpy as np
from fastapi import FastAPI, UploadFile, File, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pymongo import MongoClient
from sklearn.ensemble import IsolationForest
from transformers import pipeline
from dotenv import load_dotenv

load_dotenv()
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
client = MongoClient(MONGO_URI)
db = client['wealthsense_db']
collection = db['transactions']

app = FastAPI(title="WealthSense NLP Microservice")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

classifier = pipeline("zero-shot-classification", model="typeform/distilbert-base-uncased-mnli")
TARGET_CATEGORIES = ["Food/Dining", "Housing/Utilities", "Investments", "Misc/Anomalous"]

ml_components = {}

def train_anomaly_model():
    data = list(collection.find({"type": {"$ne": "INCOME"}}, {'_id': 0, 'amount': 1}))
    if len(data) < 10:
        return 
    
    df = pd.DataFrame(data)
    if 'amount' not in df.columns or df.empty: return
    
    iso = IsolationForest(contamination=0.15, random_state=42).fit(df[['amount']])
    ml_components['iso'] = iso

@app.on_event("startup")
def startup_event():
    train_anomaly_model()

class TransactionInput(BaseModel):
    description: str
    amount: float
    date: str
    time: str = None  # Added time parameter
    type: str = "EXPENSE"
    category: str = None

class UpdateCategoryInput(BaseModel):
    category: str

def get_rule_based_category(description: str) -> str:
    desc_lower = description.lower()
    rules = {
        "Food/Dining": ['food', 'swiggy', 'zomato', 'lunch', 'dinner', 'restaurant', 'cafe', 'grocery', 'blinkit', 'zepto'],
        "Housing/Utilities": ['rent', 'electricity', 'water', 'wifi', 'utility', 'bill', 'landlord', 'maintenance', 'pg'],
        "Investments": ['zerodha', 'groww', 'mutual fund', 'sip', 'stock', 'upstox', 'coin']
    }
    for category, keywords in rules.items():
        if any(keyword in desc_lower for keyword in keywords):
            return category
    return None

@app.post("/api/ml/single")
def predict_single(txn: TransactionInput, background_tasks: BackgroundTasks):
    if 'iso' not in ml_components:
        train_anomaly_model()
        
    txn_id = "TXN" + str(uuid.uuid4().hex)[:8].upper()
    current_time = txn.time if txn.time else datetime.now().strftime("%H:%M")
    
    if txn.type == "INCOME":
        record = {
            "transaction_id": txn_id,
            "description": txn.description,
            "amount": txn.amount,
            "date": txn.date,
            "time": current_time,
            "category": "Income",
            "is_anomaly": False,
            "type": "INCOME"
        }
        collection.insert_one(record)
        del record['_id']
        return {"status": "success", "data": record}

    if txn.category and txn.category in TARGET_CATEGORIES:
        assigned_category = txn.category
    else:
        clean_desc = txn.description.replace('UPI-', '').replace('NEFT-', '').replace('POS-', '')
        assigned_category = get_rule_based_category(clean_desc)
        
        if not assigned_category:
            nlp_result = classifier(clean_desc, TARGET_CATEGORIES)
            top_label = nlp_result['labels'][0]
            top_score = nlp_result['scores'][0]
            
            if top_score < 0.45:
                assigned_category = "Misc/Anomalous"
            else:
                assigned_category = top_label
    
    is_anomaly = False
    if 'iso' in ml_components:
        score = ml_components['iso'].predict(pd.DataFrame([{"amount": txn.amount}]))[0]
        is_anomaly = True if score == -1 else False

    record = {
        "transaction_id": txn_id,
        "description": txn.description,
        "amount": txn.amount,
        "date": txn.date,
        "time": current_time,
        "category": assigned_category,
        "is_anomaly": is_anomaly,
        "type": "EXPENSE"
    }
    
    collection.insert_one(record)
    del record['_id']
    background_tasks.add_task(train_anomaly_model)
    return {"status": "success", "data": record}

@app.put("/api/ml/update/{transaction_id}")
def update_transaction_category(transaction_id: str, data: UpdateCategoryInput):
    if data.category not in TARGET_CATEGORIES and data.category != "Income":
        return {"status": "error", "message": "Invalid category mapping input"}
        
    result = collection.update_one({"transaction_id": transaction_id}, {"$set": {"category": data.category}})
    if result.matched_count > 0:
        return {"status": "success", "message": "Category updated successfully"}
    return {"status": "error", "message": "Transaction instance resource not found"}

@app.post("/api/ml/bulk")
async def predict_bulk(file: UploadFile = File(...), background_tasks: BackgroundTasks = BackgroundTasks()):
    contents = await file.read()
    if file.filename.endswith('.csv'):
        df = pd.read_csv(io.BytesIO(contents))
    else:
        df = pd.read_excel(io.BytesIO(contents), engine='openpyxl')

    df.columns = df.columns.str.strip().str.upper()
    processed_df = pd.DataFrame()
    processed_df['transaction_id'] = ['TXN' + str(uuid.uuid4().hex)[:8].upper() for _ in range(len(df))]
    
    if 'TRANSACTION DETAILS' in df.columns: 
        processed_df['description'] = df['TRANSACTION DETAILS'].fillna('Unknown Location').astype(str)
    else: 
        processed_df['description'] = "Unknown Transaction"

    if 'WITHDRAWAL AMT' in df.columns:
        processed_df['amount'] = pd.to_numeric(df['WITHDRAWAL AMT'], errors='coerce')
        processed_df = processed_df[processed_df['amount'] > 0]
    else: 
        processed_df['amount'] = 0.0

    if 'DATE' in df.columns: 
        processed_df['date'] = df['DATE'].astype(str)
    else: 
        processed_df['date'] = "2026-06-01"

    processed_df = processed_df.dropna(subset=['amount']).reset_index(drop=True)
    processed_df['clean_desc'] = processed_df['description'].str.replace(r'^(UPI|NEFT|POS|IMPS)-', '', regex=True)
    
    categories = []
    for desc in processed_df['clean_desc'].tolist():
        cat = get_rule_based_category(desc)
        if not cat:
            nlp_result = classifier(desc, TARGET_CATEGORIES)
            top_label = nlp_result['labels'][0]
            top_score = nlp_result['scores'][0]
            
            if top_score < 0.45:
                cat = "Misc/Anomalous"
            else:
                cat = top_label
        categories.append(cat)
        
    processed_df['category'] = categories
    processed_df['time'] = "12:00" # Default timestamp for bulk inserts
    
    if 'iso' in ml_components:
        processed_df['is_anomaly'] = np.where(ml_components['iso'].predict(processed_df[['amount']]) == -1, True, False)
    else:
        processed_df['is_anomaly'] = False
        
    processed_df['type'] = "EXPENSE"
    processed_df = processed_df.drop(columns=['clean_desc'])
    records = processed_df.to_dict('records')
    
    for record in records:
        collection.update_one({'transaction_id': record['transaction_id']}, {'$set': record}, upsert=True)
        
    background_tasks.add_task(train_anomaly_model)
    return {"status": "success", "inserted": len(records)}

@app.delete("/api/ml/delete/{transaction_id}")
def delete_transaction(transaction_id: str, background_tasks: BackgroundTasks):
    result = collection.delete_one({"transaction_id": transaction_id})
    if result.deleted_count > 0:
        background_tasks.add_task(train_anomaly_model)
        return {"status": "success", "message": "Transaction deleted"}
    return {"status": "error", "message": "Transaction not found"}
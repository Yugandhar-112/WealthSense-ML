import os
import io
import uuid
import pandas as pd
import numpy as np
from fastapi import FastAPI, UploadFile, File, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pymongo import MongoClient
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import StandardScaler
from sklearn.compose import ColumnTransformer
from sklearn.cluster import KMeans
from sklearn.ensemble import IsolationForest
from dotenv import load_dotenv

load_dotenv()
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
client = MongoClient(MONGO_URI)
db = client['wealthsense_db']
collection = db['transactions']

app = FastAPI(title="WealthSense ML Microservice")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ml_components = {}
cluster_mapping = {0: 'Housing/Utilities', 1: 'Food/Dining', 2: 'Investments', 3: 'Misc/Anomalous'}

def train_models():
    # Only train ML on expenses, ignore income to prevent scaler skewing
    data = list(collection.find({"type": {"$ne": "INCOME"}}, {'_id': 0}))
    if len(data) < 10:
        return 
    
    df = pd.DataFrame(data)
    if 'description' not in df.columns: return
    df['clean_desc'] = df['description'].str.replace(r'^(UPI|NEFT|POS|IMPS)-', '', regex=True)
    
    preprocessor = ColumnTransformer(
        transformers=[
            ('text', TfidfVectorizer(max_features=100), 'clean_desc'),
            ('num', StandardScaler(), ['amount'])
        ],
        sparse_threshold=0
    )
    
    X = preprocessor.fit_transform(df)
    kmeans = KMeans(n_clusters=4, random_state=42, n_init=10).fit(X)
    iso = IsolationForest(contamination=0.15, random_state=42).fit(X)
    
    ml_components['preprocessor'] = preprocessor
    ml_components['kmeans'] = kmeans
    ml_components['iso'] = iso

@app.on_event("startup")
def startup_event():
    train_models()

# Added 'type' variable to schema
class TransactionInput(BaseModel):
    description: str
    amount: float
    date: str
    type: str = "EXPENSE"

@app.post("/api/ml/single")
def predict_single(txn: TransactionInput, background_tasks: BackgroundTasks):
    if not ml_components:
        train_models()
        
    txn_id = "TXN" + str(uuid.uuid4().hex)[:8].upper()
    
    # Bypass ML entirely for Income
    if txn.type == "INCOME":
        record = {
            "transaction_id": txn_id,
            "description": txn.description,
            "amount": txn.amount,
            "date": txn.date,
            "category_cluster": -1,
            "category": "Income",
            "is_anomaly": False,
            "type": "INCOME"
        }
        collection.insert_one(record)
        del record['_id'] # FIX: Remove MongoDB ObjectId before returning JSON
        return {"status": "success", "data": record}

    # Expense Pipeline
    df = pd.DataFrame([{"description": txn.description, "amount": txn.amount, "date": txn.date}])
    df['clean_desc'] = df['description'].str.replace(r'^(UPI|NEFT|POS|IMPS)-', '', regex=True)
    
    X = ml_components['preprocessor'].transform(df)
    
    # HYBRID ML: Rule-Based Override
    desc_lower = txn.description.lower()
    if any(word in desc_lower for word in ['food', 'swiggy', 'zomato', 'lunch', 'dinner', 'restaurant', 'cafe', 'grocery']):
        cluster = 1
        cat_name = 'Food/Dining'
    elif any(word in desc_lower for word in ['rent', 'electricity', 'water', 'wifi', 'utility', 'bill']):
        cluster = 0
        cat_name = 'Housing/Utilities'
    else:
        cluster = int(ml_components['kmeans'].predict(X)[0])
        cat_name = cluster_mapping.get(cluster, "Unknown")
        
    anomaly_score = int(ml_components['iso'].predict(X)[0])
    
    record = {
        "transaction_id": txn_id,
        "description": txn.description,
        "amount": txn.amount,
        "date": txn.date,
        "category_cluster": cluster,
        "category": cat_name,
        "is_anomaly": True if anomaly_score == -1 else False,
        "type": "EXPENSE"
    }
    
    collection.insert_one(record)
    del record['_id'] # FIX: Remove MongoDB ObjectId before returning JSON
    background_tasks.add_task(train_models)
    return {"status": "success", "data": record}

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
    
    if 'TRANSACTION DETAILS' in df.columns: processed_df['description'] = df['TRANSACTION DETAILS'].fillna('Unknown Location').astype(str)
    else: processed_df['description'] = "Unknown Transaction"

    if 'WITHDRAWAL AMT' in df.columns:
        processed_df['amount'] = pd.to_numeric(df['WITHDRAWAL AMT'], errors='coerce')
        processed_df = processed_df[processed_df['amount'] > 0]
    else: processed_df['amount'] = 0.0

    if 'DATE' in df.columns: processed_df['date'] = df['DATE'].astype(str)
    else: processed_df['date'] = "2026-06-01"

    processed_df = processed_df.dropna(subset=['amount']).reset_index(drop=True)
    processed_df['clean_desc'] = processed_df['description'].str.replace(r'^(UPI|NEFT|POS|IMPS)-', '', regex=True)
    
    X = ml_components['preprocessor'].transform(processed_df)
    processed_df['category_cluster'] = ml_components['kmeans'].predict(X)
    processed_df['category'] = processed_df['category_cluster'].map(cluster_mapping)
    processed_df['is_anomaly'] = np.where(ml_components['iso'].predict(X) == -1, True, False)
    processed_df['type'] = "EXPENSE"
    
    processed_df = processed_df.drop(columns=['clean_desc'])
    records = processed_df.to_dict('records')
    
    for record in records:
        collection.update_one({'transaction_id': record['transaction_id']}, {'$set': record}, upsert=True)
        
    background_tasks.add_task(train_models)
    return {"status": "success", "inserted": len(records)}

@app.delete("/api/ml/delete/{transaction_id}")
def delete_transaction(transaction_id: str, background_tasks: BackgroundTasks):
    result = collection.delete_one({"transaction_id": transaction_id})
    if result.deleted_count > 0:
        background_tasks.add_task(train_models)
        return {"status": "success", "message": "Transaction deleted"}
    return {"status": "error", "message": "Transaction not found"}
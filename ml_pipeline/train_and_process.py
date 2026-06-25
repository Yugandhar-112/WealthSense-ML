import os
import pandas as pd
import numpy as np
import glob
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import StandardScaler
from sklearn.compose import ColumnTransformer
from sklearn.cluster import KMeans
from sklearn.ensemble import IsolationForest
from sklearn.pipeline import Pipeline
from pymongo import MongoClient
from dotenv import load_dotenv

# Load environment variables
load_dotenv()
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/")

def fetch_data():
    # Auto-detect CSV or Excel files in the directory
    files = glob.glob(os.path.join(os.path.dirname(__file__), "*.csv")) + \
            glob.glob(os.path.join(os.path.dirname(__file__), "*.xlsx"))
    
    if not files:
        print("CRITICAL ERROR: No .csv or .xlsx dataset found in the ml_pipeline folder.")
        exit(1)
        
    target_file = files[0]
    print(f"Ingesting dataset: {os.path.basename(target_file)}")
    
    # Load dataset based on extension (Limit to 10k rows for local DB performance)
    if target_file.endswith('.csv'):
        df = pd.read_csv(target_file, nrows=10000)
    else:
        df = pd.read_excel(target_file, nrows=10000, engine='openpyxl')

    # Standardize headers (strip spaces and uppercase) to prevent KeyErrors
    df.columns = df.columns.str.strip().str.upper()
    processed_df = pd.DataFrame()

    # 1. Map Transaction ID
    if 'TRANSACTIONID' in df.columns:
        processed_df['transaction_id'] = df['TRANSACTIONID'].astype(str)
    else:
        # Generate synthetic IDs if missing
        processed_df['transaction_id'] = ['TXN' + str(i).zfill(5) for i in range(len(df))]

    # 2. Map Description (Handles Kaggle or HDFC formats)
    if 'CUSTLOCATION' in df.columns:
        processed_df['description'] = df['CUSTLOCATION'].fillna('Unknown Location').astype(str)
    elif 'TRANSACTION DETAILS' in df.columns:
        processed_df['description'] = df['TRANSACTION DETAILS'].fillna('Unknown Location').astype(str)
    else:
        processed_df['description'] = "Unknown Transaction"

    # 3. Map Amount & Filter for Spending
    if 'AMOUNT (INR)' in df.columns:
        processed_df['amount'] = pd.to_numeric(df['AMOUNT (INR)'], errors='coerce')
    elif 'WITHDRAWAL AMT' in df.columns:
        processed_df['amount'] = pd.to_numeric(df['WITHDRAWAL AMT'], errors='coerce')
        # Drop deposits (where withdrawal is 0/NaN)
        processed_df = processed_df[processed_df['amount'] > 0]
    else:
        processed_df['amount'] = 0.0

    # 4. Map Date
    if 'TRANSACTIONDATE' in df.columns:
        processed_df['date'] = df['TRANSACTIONDATE'].astype(str)
    elif 'DATE' in df.columns:
        processed_df['date'] = df['DATE'].astype(str)
    else:
        processed_df['date'] = "2026-06-01"

    # Drop any corrupt rows with missing amounts and reset index
    processed_df = processed_df.dropna(subset=['amount']).reset_index(drop=True)
    return processed_df

def process_pipeline():
    data = fetch_data()
    print(f"Data successfully mapped. Processing {len(data)} valid transactions...")
    
    # Preprocessing text to remove banking prefixes
    data['clean_desc'] = data['description'].str.replace(r'^(UPI|NEFT|POS|IMPS)-', '', regex=True)
    
    preprocessor = ColumnTransformer(
        transformers=[
            ('text', TfidfVectorizer(max_features=100), 'clean_desc'),
            ('num', StandardScaler(), ['amount'])
        ],
        sparse_threshold=0
    )

    # Train Models
    clusterer = Pipeline([('prep', preprocessor), ('kmeans', KMeans(n_clusters=4, random_state=42, n_init=10))])
    anomaly_detector = Pipeline([('prep', preprocessor), ('iso', IsolationForest(contamination=0.15, random_state=42))])

    data['category_cluster'] = clusterer.fit_predict(data)
    data['is_anomaly'] = np.where(anomaly_detector.fit_predict(data) == -1, True, False)
    
    # Map ML Clusters to Human Labels
    cluster_mapping = {0: 'Housing/Utilities', 1: 'Food/Dining', 2: 'Investments', 3: 'Misc/Anomalous'}
    data['category'] = data['category_cluster'].map(cluster_mapping)

    # Push to MongoDB
    client = MongoClient(MONGO_URI)
    db = client['wealthsense_db']
    collection = db['transactions']
    
    # Upsert data into database
    records = data.to_dict('records')
    for record in records:
        collection.update_one({'transaction_id': record['transaction_id']}, {'$set': record}, upsert=True)
        
    print("SUCCESS: Machine Learning pipeline executed. Data live in MongoDB.")

if __name__ == "__main__":
    process_pipeline()
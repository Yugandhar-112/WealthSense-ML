import os
import pandas as pd
import numpy as np
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
    # Updated to target bank.xlsx
    excel_path = os.path.join(os.path.dirname(__file__), "bank.xlsx")
    if not os.path.exists(excel_path):
        print(f"Error: {excel_path} not found. Falling back to mock data.")
        return pd.DataFrame({
            'transaction_id': ['TXN01', 'TXN02', 'TXN03', 'TXN04', 'TXN05', 'TXN06'],
            'description': ['UPI-Zomato-Food', 'NEFT-Landlord-Rent', 'UPI-Zerodha-MutualFund', 'POS-Reliance-Groceries', 'International-AWS-Cloud', 'UPI-Unknown-Transfer'],
            'amount': [350, 25000, 5000, 1200, 1500, 95000],
            'date': ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05', '2026-06-06']
        })
    
    # Read first 10,000 rows using openpyxl engine
    df = pd.read_excel(excel_path, nrows=10000, engine='openpyxl')
    
    # Map dataset columns to database schema
    processed_df = pd.DataFrame()
    processed_df['transaction_id'] = df['TransactionID'].astype(str)
    processed_df['description'] = df['CustLocation'].fillna('Unknown Location').astype(str)
    processed_df['amount'] = df['Amount (INR)'].astype(float)
    processed_df['date'] = df['TransactionDate'].astype(str)
    
    return processed_df

def process_pipeline():
    data = fetch_data()
    
    # Preprocessing
    data['clean_desc'] = data['description'].str.replace(r'^(UPI|NEFT|POS|IMPS)-', '', regex=True)
    
    preprocessor = ColumnTransformer(
        transformers=[
            ('text', TfidfVectorizer(max_features=100), 'clean_desc'),
            ('num', StandardScaler(), ['amount'])
        ]
    )

    # Train Clustering & Anomaly Models
    clusterer = Pipeline([('prep', preprocessor), ('kmeans', KMeans(n_clusters=4, random_state=42, n_init=10))])
    anomaly_detector = Pipeline([('prep', preprocessor), ('iso', IsolationForest(contamination=0.15, random_state=42))])

    data['category_cluster'] = clusterer.fit_predict(data)
    data['is_anomaly'] = np.where(anomaly_detector.fit_predict(data) == -1, True, False)
    
    # Map clusters to readable labels
    cluster_mapping = {0: 'Housing/Utilities', 1: 'Food/Dining', 2: 'Investments', 3: 'Misc/Anomalous'}
    data['category'] = data['category_cluster'].map(cluster_mapping)

    # Push to MongoDB
    client = MongoClient(MONGO_URI)
    db = client['wealthsense_db']
    collection = db['transactions']
    
    # Upsert data
    records = data.to_dict('records')
    for record in records:
        collection.update_one({'transaction_id': record['transaction_id']}, {'$set': record}, upsert=True)
        
    print("Pipeline executed successfully. Data pushed to MongoDB.")

if __name__ == "__main__":
    process_pipeline()
import os
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer, CountVectorizer
from sklearn.naive_bayes import MultinomialNB
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, confusion_matrix
from datetime import datetime
import joblib
import spacy
from bs4 import BeautifulSoup
from dateutil import parser
import time
import re
import warnings
import numpy as np
from scipy.sparse import hstack

# Suppress specific BeautifulSoup warning
warnings.filterwarnings("ignore", category=UserWarning, module='bs4')

# Get the directory of the current script
script_dir = os.path.dirname(os.path.abspath(__file__))

# Load the combined dataset
data_path = "data/TaskNonTaskUrgencyDataset.csv"
data = pd.read_csv(data_path)

# Check for any null values in the necessary columns
data = data.dropna(subset=['Message'])

# Preprocess text
def preprocess_text(text):
    soup = BeautifulSoup(text, "html.parser")
    cleaned_text = soup.get_text().replace('\n', ' ')
    return cleaned_text

# Extract dates from text
def extract_dates(text):
    nlp = spacy.load("en_core_web_trf")
    doc = nlp(text)
    dates = []
    for ent in doc.ents:
        if ent.label_ == "DATE":
            parsed_date = None
            try:
                parsed_date = parser.parse(ent.text, fuzzy=True)
            except:
                pass
            if parsed_date:
                dates.append(parsed_date)
    return dates

# Add urgency features
def add_urgency_features(text):
    urgency_phrases = [
        'asap', 'as soon as possible', 'urgent', 'immediate', 'right away', 'by eod',
        'by end of day', 'by end of the week', 'by tomorrow', 'next week', 'in 1 day', 'in 2 days',
        'now', 'today', 'tonight', 'this morning', 'this afternoon', 'this evening'
    ]
    features = {}
    for phrase in urgency_phrases:
        features[f'contains_{phrase}'] = int(phrase in text.lower())
    return features

# Train the models
def train_models():
    # Train Task Prediction Model
    X_train_task, X_test_task, Y_train_task, Y_test_task = train_test_split(data['Message'], data['hastask'], test_size=0.2, random_state=0)
    vectorizer_task = CountVectorizer(ngram_range=(1, 2)).fit(X_train_task)
    X_train_task_vectorized = vectorizer_task.transform(X_train_task)
    model_task = MultinomialNB(alpha=0.1)
    model_task.fit(X_train_task_vectorized, Y_train_task)

    # Save Task Prediction Model
    joblib.dump(model_task, os.path.join(script_dir, 'naivemodels/model_task.pkl'))
    joblib.dump(vectorizer_task, os.path.join(script_dir, 'naivemodels/vectorizer_task.pkl'))

    # Train Urgency Prediction Model
    urgency_data = data.dropna(subset=['hastask', 'urgency'])
    X_train_urgency, X_test_urgency, Y_train_urgency, Y_test_urgency = train_test_split(urgency_data['Message'], urgency_data['urgency'], test_size=0.2, random_state=0)
    vectorizer_urgency = TfidfVectorizer(ngram_range=(1, 2)).fit(X_train_urgency)
    X_train_urgency_vectorized = vectorizer_urgency.transform(X_train_urgency)
    X_test_urgency_vectorized = vectorizer_urgency.transform(X_test_urgency)

    # Add custom urgency features to training data
    urgency_features_train = [add_urgency_features(text) for text in X_train_urgency]
    urgency_features_matrix_train = np.array([list(features.values()) for features in urgency_features_train])
    X_train_urgency_vectorized = hstack([X_train_urgency_vectorized, urgency_features_matrix_train])

    urgency_features_test = [add_urgency_features(text) for text in X_test_urgency]
    urgency_features_matrix_test = np.array([list(features.values()) for features in urgency_features_test])
    X_test_urgency_vectorized = hstack([X_test_urgency_vectorized, urgency_features_matrix_test])

    model_urgency = MultinomialNB(alpha=0.1)
    model_urgency.fit(X_train_urgency_vectorized, Y_train_urgency)

    # Save Urgency Prediction Model
    joblib.dump(model_urgency, os.path.join(script_dir, 'naivemodels/model_urgency.pkl'))
    joblib.dump(vectorizer_urgency, os.path.join(script_dir, 'naivemodels/vectorizer_urgency.pkl'))

    # Evaluate models
    evaluate_models(model_task, vectorizer_task, X_test_task, Y_test_task, model_urgency, vectorizer_urgency, X_test_urgency, Y_test_urgency)

# Evaluate models
def evaluate_models(model_task, vectorizer_task, X_test_task, Y_test_task, model_urgency, vectorizer_urgency, X_test_urgency, Y_test_urgency):
    # Evaluate Task Prediction Model
    X_test_task_vectorized = vectorizer_task.transform(X_test_task)
    Y_pred_task = model_task.predict(X_test_task_vectorized)

    print("Task Prediction Model Performance:")
    print("Accuracy:", accuracy_score(Y_test_task, Y_pred_task))
    print("Precision:", precision_score(Y_test_task, Y_pred_task))
    print("Recall:", recall_score(Y_test_task, Y_pred_task))
    print("F1 Score:", f1_score(Y_test_task, Y_pred_task))
    print("Confusion Matrix:\n", confusion_matrix(Y_test_task, Y_pred_task))

    # Evaluate Urgency Prediction Model
    X_test_urgency_vectorized = vectorizer_urgency.transform(X_test_urgency)
    urgency_features_test = [add_urgency_features(text) for text in X_test_urgency]
    urgency_features_matrix_test = np.array([list(features.values()) for features in urgency_features_test])
    X_test_urgency_vectorized = hstack([X_test_urgency_vectorized, urgency_features_matrix_test])
    Y_pred_urgency = model_urgency.predict(X_test_urgency_vectorized)

    print("\nUrgency Prediction Model Performance:")
    print("Accuracy:", accuracy_score(Y_test_urgency, Y_pred_urgency))
    print("Precision:", precision_score(Y_test_urgency, Y_pred_urgency, average='weighted'))
    print("Recall:", recall_score(Y_test_urgency, Y_pred_urgency, average='weighted'))
    print("F1 Score:", f1_score(Y_test_urgency, Y_pred_urgency, average='weighted'))
    print("Confusion Matrix:\n", confusion_matrix(Y_test_urgency, Y_pred_urgency))


def main():
    # Train the models and evaluate
    train_models()


if __name__ == "__main__":
    main()

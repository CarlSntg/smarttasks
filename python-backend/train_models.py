import os
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer, CountVectorizer
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.naive_bayes import MultinomialNB
from sklearn.model_selection import GridSearchCV, train_test_split
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
    """Extract dates from text using spaCy's NER and convert them to datetime objects."""
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
    X_train_task, _, Y_train_task, _ = train_test_split(data['Message'], data['hastask'], test_size=0.2, random_state=0)
    vectorizer_task = CountVectorizer(ngram_range=(1, 2)).fit(X_train_task)
    X_train_task_vectorized = vectorizer_task.transform(X_train_task)
    model_task = MultinomialNB(alpha=0.1)
    model_task.fit(X_train_task_vectorized, Y_train_task)

    # Save Task Prediction Model
    joblib.dump(model_task, os.path.join(script_dir, 'models/model_task.pkl'))
    joblib.dump(vectorizer_task, os.path.join(script_dir, 'models/vectorizer_task.pkl'))

    # Train Urgency Prediction Model
    urgency_data = data.dropna(subset=['hastask','urgency'])
    X_train_urgency, _, Y_train_urgency, _ = train_test_split(urgency_data['Message'], urgency_data['urgency'],
                                                              test_size=0.2, random_state=0)
    vectorizer_urgency = TfidfVectorizer(ngram_range=(1, 2)).fit(X_train_urgency)
    X_train_urgency_vectorized = vectorizer_urgency.transform(X_train_urgency)

    # Add custom urgency features to training data
    urgency_features_train = [add_urgency_features(text) for text in X_train_urgency]
    urgency_features_matrix = np.array([list(features.values()) for features in urgency_features_train])
    X_train_urgency_vectorized = hstack([X_train_urgency_vectorized, urgency_features_matrix])

    model_urgency = GradientBoostingClassifier()
    parameters = {'n_estimators': [100, 200, 300], 'learning_rate': [0.01, 0.1, 0.5]}
    grid_search = GridSearchCV(model_urgency, parameters, cv=3, n_jobs=-1)
    grid_search.fit(X_train_urgency_vectorized, Y_train_urgency)

    # Save Urgency Prediction Model
    joblib.dump(grid_search.best_estimator_, os.path.join(script_dir, 'models/model_urgency.pkl'))
    joblib.dump(vectorizer_urgency, os.path.join(script_dir, 'models/vectorizer_urgency.pkl'))


# Evaluate importance and urgency of an email
def evaluate_importance_and_urgency(sender, subject, body, email_date):
    # Load pre-trained models
    model_task = joblib.load(os.path.join(script_dir, 'models/model_task.pkl'))
    vectorizer_task = joblib.load(os.path.join(script_dir, 'models/vectorizer_task.pkl'))
    model_urgency = joblib.load(os.path.join(script_dir, 'models/model_urgency.pkl'))
    vectorizer_urgency = joblib.load(os.path.join(script_dir, 'models/vectorizer_urgency.pkl'))

    nlp = spacy.load("en_core_web_sm")
    body = preprocess_text(body)
    combined_text = subject + '\n' + body
    doc = nlp(combined_text)
    preprocessed_text = ' '.join([token.lemma_ for token in doc if not token.is_stop])

    combined_text_task_vectorized = vectorizer_task.transform([preprocessed_text])
    task_keywords = ['assignment', 'task', 'deadline', 'as soon as possible', 'ASAP']
    task = 0

    if any(keyword in combined_text.lower() for keyword in task_keywords):
        task = 1
    else:
        task_prediction = model_task.predict(combined_text_task_vectorized)
        if task_prediction[0] == 1:
            task = 1

    urgency = 1
    deadline_str = None

    if str(task) == '1':
        combined_text_urgency_vectorized = vectorizer_urgency.transform([preprocessed_text])
        urgency_features = add_urgency_features(preprocessed_text)
        urgency_features_matrix = np.array([list(urgency_features.values())])
        combined_text_urgency_vectorized = hstack([combined_text_urgency_vectorized, urgency_features_matrix])
        urgency_prediction = model_urgency.predict(combined_text_urgency_vectorized)

        deadlines = extract_dates(combined_text)  # Extract dates from both subject and body
        deadline_urgency = 1

        # Separate string and datetime objects for parsing deadlines
        datetime_deadlines = [d for d in deadlines if isinstance(d, datetime)]
        string_deadlines = [d for d in deadlines if isinstance(d, str)]

        if datetime_deadlines:
            closest_deadline = min(datetime_deadlines).replace(tzinfo=None)  # Make closest_deadline offset-naive
            days_until_deadline = (
                        closest_deadline - email_date.replace(tzinfo=None)).days  # Make email_date offset-naive
            deadline_str = closest_deadline.isoformat()

            if days_until_deadline <= 3:
                deadline_urgency = 3  # Urgent
            elif days_until_deadline <= 7:
                deadline_urgency = 2  # Somewhat Urgent
            else:
                deadline_urgency = 1  # Not Urgent

        if string_deadlines:
            for string_deadline in string_deadlines:
                if any(phrase in string_deadline.lower() for phrase in
                       ['by end of the day', 'by eod', 'immediate', 'right away']):
                    deadline_urgency = max(deadline_urgency, 3)  # Urgent
                elif any(phrase in string_deadline.lower() for phrase in
                         ['by end of the week', 'by tomorrow', 'next week']):
                    deadline_urgency = max(deadline_urgency, 2)  # Somewhat Urgent

        urgency = max(urgency_prediction[0], deadline_urgency)

    urgency_levels = {1: 'Not Urgent', 2: 'Somewhat Urgent', 3: 'Urgent'}
    urgency_level = urgency_levels.get(urgency, 'Not Urgent')

    print("------------------------------------\n")
    print(time.strftime("%I:%M:%S %p"))
    print(f"{sender}\n")
    print(f"{subject}\n")
    print(f"{body}\n")
    print(f"Email Date: {email_date}")
    print(urgency_level if str(task) == '1' else 'NonTask')
    if deadline_str:
        print(f"Deadline: {deadline_str}")

    return {"task": task, "urgency": urgency, "deadline": deadline_str}


def main():
    # Train the models
    train_models()

    # Example Emails for Testing
    email_examples = [
        {
            "sender": "finance@example.com",
            "subject": "Reminder: Submit Expense Reports by June 30, 2024",
            "body": """Dear Team,

        I hope this message finds you well.

        As we approach the end of the quarter, this is a gentle reminder to submit your expense reports. The deadline for submission is June 30, 2024, by 5:00 PM.

        Please ensure that all receipts and relevant documentation are included in your submission. Adherence to this deadline is crucial for timely processing.

        Thank you for your cooperation.

        Best regards,
        Finance Department""",
            "email_date": datetime(2024, 5, 30, 8, 0, 0)
        },
        {
            "sender": "project.coordinator@example.com",
            "subject": "Follow-Up: Project Plan Submission by June 5, 2024",
            "body": """Dear Team,

        I hope you are doing well.

        This is a follow-up reminder to submit your project plans. The deadline for submission is June 5, 2024, by 5:00 PM.

        Timely submission is critical for project approval and commencement. Please ensure all necessary details are included.

        Thank you for your prompt attention to this matter.

        Best regards,
        Project Coordinator""",
            "email_date": datetime(2024, 5, 30, 8, 0, 0)
        },
        {
            "sender": "compliance.officer@example.com",
            "subject": "Immediate Attention Required: Compliance Report by June 1, 2024",
            "body": """Dear Team,

        Your immediate attention is required.

        Please submit the compliance report by June 1, 2024, by end of day. This is of utmost importance to ensure we meet regulatory requirements.

        Your cooperation and timely response are highly appreciated.

        Best regards,
        Compliance Officer""",
            "email_date": datetime(2024, 5, 30, 8, 0, 0)
        }
    ]

    # Evaluate each email example
    for email in email_examples:
        print(f"Processing email from: {email['sender']} with subject: {email['subject']}")
        result = evaluate_importance_and_urgency(email['sender'], email['subject'], email['body'], email['email_date'])
        print(f"Result: {result}\n")


if __name__ == "__main__":
    main()

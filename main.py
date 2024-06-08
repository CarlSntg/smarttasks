#!/usr/bin/env python3

import os
import re
import time
from datetime import datetime
from dateutil import parser
import threading
from scipy.sparse import hstack
import logging
import joblib
import spacy
from bs4 import BeautifulSoup
import pytz
import warnings
import numpy as np
from pymongo import MongoClient, UpdateOne, DeleteOne
from pymongo.errors import DuplicateKeyError
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
import schedule
from dotenv import load_dotenv

# Suppress specific BeautifulSoup warning
warnings.filterwarnings("ignore", category=UserWarning, module='bs4')

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# Load environment variables from .env file
load_dotenv()

# MongoDB connection details
MONGO_URI = os.getenv('MONGO_URI')
DATABASE_NAME = os.getenv('DB_NAME')
BATCH_SIZE = 20
CHECK_INTERVAL = 5  # 5 seconds

client = MongoClient(MONGO_URI)
db = client[DATABASE_NAME]

EMAIL_ADDRESS = os.getenv('EMAIL_ADDRESS')
EMAIL_PASSKEY = os.getenv('EMAIL_PASSKEY')

# Load the models
script_dir = os.path.dirname(os.path.abspath(__file__))
model_task = joblib.load(os.path.join(script_dir, 'models/model_task.pkl'))
vectorizer_task = joblib.load(os.path.join(script_dir, 'models/vectorizer_task.pkl'))
model_urgency = joblib.load(os.path.join(script_dir, 'models/model_urgency.pkl'))
vectorizer_urgency = joblib.load(os.path.join(script_dir, 'models/vectorizer_urgency.pkl'))

nlp = spacy.load("en_core_web_trf")


def preprocess_email_body(text):
    soup = BeautifulSoup(text, "html.parser")
    cleaned_text = soup.get_text().replace('\n', ' ')
    return cleaned_text


def extract_dates_from_text(text):
    doc = nlp(text)
    dates = []
    for ent in doc.ents:
        if ent.label_ == "DATE":
            try:
                parsed_date = parser.parse(ent.text, fuzzy=True)
                dates.append(parsed_date)
            except:
                pass
    return dates


def add_urgency_indicators(text):
    urgency_phrases = [
        'asap', 'as soon as possible', 'urgent', 'immediate', 'right away', 'by eod',
        'by end of day', 'by end of the week', 'by tomorrow', 'next week', 'in 1 day', 'in 2 days',
        'now', 'today', 'tonight', 'this morning', 'this afternoon', 'this evening'
    ]
    features = {}
    for phrase in urgency_phrases:
        features[f'contains_{phrase}'] = int(phrase in text.lower())
    return features


def format_task_deadline(deadline):
    if deadline:
        if isinstance(deadline, str):
            try:
                deadline = datetime.fromisoformat(deadline)
            except ValueError:
                return 'Invalid deadline format'
        return deadline.strftime('%B %d, %Y')
    return 'No deadline specified'


def validate_email_address(email):
    pattern = r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
    return bool(re.match(pattern, email))


def ensure_unique_index_on_email_id(collection):
    indexes = collection.index_information()
    if "emailId_1" not in indexes:
        try:
            collection.create_index("emailId", unique=True, sparse=True, name="emailId_1")
            logging.info(f"Created unique index on emailId for collection {collection.name}")
        except DuplicateKeyError as e:
            logging.warning(f"Duplicate key error while creating index on emailId for collection {collection.name}: {e}")


def send_urgent_tasks_email(urgent_tasks, user_email):
    if not validate_email_address(user_email):
        logging.warning(f"Skipping invalid email address: {user_email}")
        return

    try:
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(EMAIL_ADDRESS, EMAIL_PASSKEY)

        msg = MIMEMultipart()
        msg['From'] = EMAIL_ADDRESS
        msg['To'] = user_email
        msg['Subject'] = "Urgent Tasks for Today"

        urgent_tasks_list = list(urgent_tasks)

        if not urgent_tasks_list:
            html = "<html><body><p>You have no urgent tasks for today! Relax and unwind.</p></body></html>"
        else:
            html = """
            <html>
            <head>
            <style>
                table {width: 100%; border-collapse: collapse;}
                table, th, td {border: 1px solid black;}
                th, td {padding: 10px; text-align: left;}
                th {background-color: #f2f2f2;}
            </style>
            </head>
            <body>
                <p>Here's your urgent tasks for today:</p>
                <table>
                    <tr><th>Sender</th><th>Task</th><th>Deadline</th></tr>"""

            for task in urgent_tasks_list:
                sender = task.get('sender', 'Unknown Sender')
                subject = task.get('subject', 'No Subject')
                deadline = format_task_deadline(task.get('deadline'))
                html += f"<tr><td>{sender}</td><td>{subject}</td><td>{deadline}</td></tr>"

            html += "</table><p>Do more with your tasks by launching your SmartTasks add-on!</p></body></html>"

        msg.attach(MIMEText(html, 'html'))
        server.sendmail(msg['From'], msg['To'], msg.as_string())
        server.quit()
        logging.info(f"Email sent to {user_email}")
    except smtplib.SMTPException as e:
        logging.error(f"Error sending email to {user_email}: {e}")


def evaluate_email_task_and_urgency(sender, subject, body, email_date):
    body = preprocess_email_body(body)
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

    if task == 1:
        combined_text_urgency_vectorized = vectorizer_urgency.transform([preprocessed_text])
        urgency_features = add_urgency_indicators(preprocessed_text)
        urgency_features_matrix = np.array([list(urgency_features.values())])
        combined_text_urgency_vectorized = hstack([combined_text_urgency_vectorized, urgency_features_matrix])
        urgency_prediction = model_urgency.predict(combined_text_urgency_vectorized)

        deadlines = extract_dates_from_text(combined_text)
        deadline_urgency = 1

        if deadlines:
            closest_deadline = min(deadlines).replace(tzinfo=None)
            days_until_deadline = (closest_deadline - email_date.replace(tzinfo=None)).days
            deadline_str = closest_deadline.isoformat()

            if days_until_deadline <= 3:
                deadline_urgency = 3
            elif days_until_deadline <= 7:
                deadline_urgency = 2
            else:
                deadline_urgency = 1

        urgency = max(urgency_prediction[0], deadline_urgency)

    urgency_levels = {1: 'Not Urgent', 2: 'Somewhat Urgent', 3: 'Urgent'}
    urgency_level = urgency_levels.get(urgency, 'Not Urgent')

    return {"task": task, "urgency": urgency, "deadline": deadline_str, "urgency_level": urgency_level}


def process_single_document(doc, collection_name):
    logging.info(f"Processing document in collection {collection_name} with _id {doc['_id']}")
    email_date = doc['createdat'] if isinstance(doc['createdat'], datetime) else datetime.fromisoformat(doc['createdat'][:-1])
    result = evaluate_email_task_and_urgency(doc['sender'], doc['subject'], doc['body'], email_date)
    return {
        "_id": doc["_id"],
        "update": {
            "processed": True,
            "task": doc['subject'] if result['task'] else None,
            "deadline": result['deadline'],
            "urgency": result['urgency_level'],
            "hastask": bool(result['task']),
            "completed": False
        }
    }


def process_collection_documents(collection):
    docs_to_process = list(collection.find({"processed": False}).limit(BATCH_SIZE))
    ensure_unique_index_on_email_id(collection)

    if not docs_to_process:
        logging.info(f"No documents to process in collection {collection.name}")
        return

    updates = []
    email_ids = set()
    for doc in docs_to_process:
        email_id = doc.get('emailId')
        if not email_id:
            logging.warning(f"Document with _id {doc['_id']} is missing emailId")
            continue

        if email_id in email_ids:
            updates.append(DeleteOne({"_id": doc["_id"]}))
            logging.info(f"Deleting duplicate document with _id {doc['_id']} in collection {collection.name}")
        else:
            email_ids.add(email_id)
            updates.append(UpdateOne({"_id": doc["_id"]}, {"$set": process_single_document(doc, collection.name)["update"]}))
            logging.info(f"Processing document with _id {doc['_id']} in collection {collection.name}")

    if updates:
        try:
            logging.info(f"Bulk writing updates to collection {collection.name}")
            result = collection.bulk_write(updates)
            logging.info(f"Bulk write result: {result.bulk_api_result}")
        except Exception as e:
            logging.error(f"Error during bulk write: {e}")

    remove_unprocessed_duplicates(collection)


def remove_unprocessed_duplicates(collection):
    processed_docs = collection.find({"processed": True, "emailId": {"$exists": True}})
    processed_email_ids = {doc['emailId']: doc['_id'] for doc in processed_docs}

    delete_operations = [
        DeleteOne({"_id": doc["_id"]})
        for doc in collection.find({"emailId": {"$in": list(processed_email_ids.keys())}, "processed": False})
    ]

    if delete_operations:
        try:
            logging.info(f"Deleting unprocessed duplicates in collection {collection.name}")
            result = collection.bulk_write(delete_operations)
            logging.info(f"Delete operations result: {result.bulk_api_result}")
        except Exception as e:
            logging.error(f"Error during delete operations: {e}")


def continuously_process_documents():
    while True:
        for collection_name in db.list_collection_names():
            collection = db[collection_name]
            process_collection_documents(collection)
        logging.info(f"------------------------------------New Check------------------------------------")
        time.sleep(CHECK_INTERVAL)


def monitor_changes_in_collections():
    pipeline = [
        {"$match": {"operationType": {"$in": ["insert", "update", "create"]}}}
    ]

    while True:
        with client.start_session() as session:
            with session.start_transaction():
                for collection_name in db.list_collection_names():
                    collection = db[collection_name]
                    ensure_unique_index_on_email_id(collection)
                    change_stream = collection.watch(pipeline)
                    for change in change_stream:
                        doc_id = change["documentKey"]["_id"]
                        doc = collection.find_one({"_id": doc_id})
                        if doc and not doc.get("processed", True):
                            logging.info(f"Change detected in collection {collection_name} for document with _id {doc_id}")
                            process_single_document(doc, collection.name)
        time.sleep(CHECK_INTERVAL)


def fetch_urgent_tasks_for_today(collection_name):
    gmail_collection = db[collection_name]
    urgent_tasks = gmail_collection.find({
        "urgency": "Urgent",
        "processed": True,
        "completed": False,
    })
    return urgent_tasks


def list_collections_for_email():
    for collection_name in db.list_collection_names():
        if not validate_email_address(collection_name):
            logging.warning(f"Skipping invalid collection name (not an email): {collection_name}")
            continue

        urgent_tasks = fetch_urgent_tasks_for_today(collection_name)
        urgent_tasks_list = list(urgent_tasks)

        if not urgent_tasks_list:
            logging.info(f"No urgent tasks for today for {collection_name}.")
            continue

        send_urgent_tasks_email(urgent_tasks_list, collection_name)


def reprocess_task_urgencies():
    for collection_name in db.list_collection_names():
        if not validate_email_address(collection_name):
            logging.warning(f"Skipping invalid collection name (not an email): {collection_name}")
            continue

        collection = db[collection_name]
        uncompleted_tasks = collection.find({"processed": True, "completed": False, "deadline": {"$exists": True}})

        updates = []
        for task in uncompleted_tasks:
            deadline = task.get("deadline")
            if deadline:
                try:
                    if isinstance(deadline, str):
                        deadline = parser.parse(deadline)
                    now = datetime.now(pytz.utc) if deadline.tzinfo else datetime.now()
                    days_until_deadline = (deadline - now).days

                    if days_until_deadline <= 3:
                        deadline_urgency = 3
                    elif days_until_deadline <= 7:
                        deadline_urgency = 2
                    else:
                        deadline_urgency = 1

                    current_urgency_level = task.get("urgency")
                    urgency_levels = {'Not Urgent': 1, 'Somewhat Urgent': 2, 'Urgent': 3}
                    current_urgency = urgency_levels.get(current_urgency_level, 1)

                    if current_urgency != deadline_urgency:
                        new_urgency_level = {1: 'Not Urgent', 2: 'Somewhat Urgent', 3: 'Urgent'}[deadline_urgency]
                        updates.append(UpdateOne({"_id": task["_id"]}, {"$set": {"urgency": new_urgency_level}}))
                except ValueError:
                    logging.error(f"Invalid deadline format for task with _id: {task['_id']}")

        if updates:
            try:
                logging.info(f"Reprocessing urgencies for collection {collection_name}")
                result = collection.bulk_write(updates)
                logging.info(f"Reprocessing result: {result.bulk_api_result}")
            except Exception as e:
                logging.error(f"Error during reprocessing urgencies: {e}")
        else:
            logging.info(f"No reprocessed urgencies for collection {collection_name}")


def main():
    for collection_name in db.list_collection_names():
        ensure_unique_index_on_email_id(db[collection_name])

    processing_thread = threading.Thread(target=continuously_process_documents)
    watching_thread = threading.Thread(target=monitor_changes_in_collections)

    processing_thread.start()
    watching_thread.start()

    processing_thread.join()
    watching_thread.join()


if __name__ == "__main__":
    schedule.every().day.at("09:00").do(list_collections_for_email)
    schedule.every().day.at("00:00").do(reprocess_task_urgencies)

    threading.Thread(target=main).start()

    while True:
        schedule.run_pending()
        time.sleep(1)

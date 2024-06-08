# SmartTasks
AI-integrated Gmail Assistant Add-on: Task Extraction and Classification via Natural Language Processing Techniques and Naive Bayes Algorithm

This project evaluates the importance and urgency of emails by using machine learning models. It processes emails, identifies tasks, and categorizes them based on urgency levels. The system uses MongoDB for storing email data and spaCy for natural language processing.

## Features

- **Email Task and Urgency Evaluation**: Evaluates the content of emails to determine tasks and their urgency levels.
- **Continuous Document Processing**: Regularly checks for and processes unprocessed documents in MongoDB collections.
- **Real-Time Change Monitoring**: Monitors collections for real-time changes and processes documents immediately upon detection.
- **Email Notifications**: Sends daily emails listing urgent tasks to users.
- **Scheduled Reprocessing**: Reprocesses urgencies of uncompleted tasks based on their deadlines.

## Prerequisites

- Python 3.8 or higher
- MongoDB
- [spaCy](https://spacy.io/) and the `en_core_web_trf` model
- Joblib
- BeautifulSoup
- Dateutil
- Pytz
- Scipy
- Smtplib
- Dotenv
- Schedule

## File Structure

```plaintext
smarttasks/
├── models/
│   ├── model_task.pkl
│   ├── vectorizer_task.pkl
│   ├── model_urgency.pkl
│   ├── vectorizer_urgency.pkl
├── main.py
├── train_models.py
├── requirements.txt
├── .env
├── README.md
```

## File Descriptions

- `main.py`: The main script that handles document processing, change monitoring, and scheduling tasks.
- `train_models.py`: Script for training the task and urgency models.
- `requirements.txt`: List of required Python packages.
- `.env`: Environment variables for MongoDB connection and email configuration (not included in the repository).
- `model_task.pkl`: Model for detecting tasks.
- `vectorizer_task.pkl`: Vectorizer for task detection model.
- `model_urgency.pkl`: Model for detecting urgency.
- `vectorizer_urgency.pkl`: Vectorizer for urgency detection model.

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/your-username/email-task-urgency-evaluator.git
   cd email-task-urgency-evaluator
   ```

2. Install the required Python packages:

   ```bash
   pip install -r requirements.txt
   ```

3. Download and install the `en_core_web_trf` model for spaCy:

   ```bash
   python -m spacy download en_core_web_trf
   ```

4. Create a `.env` file in the root directory and add the following environment variables:

   ```plaintext
   MONGO_URI=your_mongo_uri
   DB_NAME=your_database_name
   EMAIL_ADDRESS=your_email_address
   EMAIL_PASSKEY=your_email_passkey
   ```

5. Train the models by running `train_models.py`:

   ```bash
   python train_models.py
   ```

## Usage

1. Run the main script to start processing documents and monitoring changes:

   ```bash
   python main.py
   ```

2. The script will continuously process documents and monitor changes, sending daily emails with urgent tasks and reprocessing urgencies as scheduled.

/**
 * This Gmail add-on reads emails from your inbox and extracts task-related
 * information from it. Then it sorts them by urgency (Urgent, Somewhat Urgent,
 * Not Urgent) represented by the colors of clock icons: red, orange, and yellow
 * respectively with each task. The tasks are displayed, with the task from the
 * current email opened at the top, if there is a task, and all the other tasks
 * from other emails below. There is also a section for completed tasks at the
 * bottom of the homepage card. A footer button is also available to refresh the
 * add-on.
 */

const properties = [
  'findEndpoint',
  'insertOneEndpoint',
  'updateOneEndpoint',
  'deleteEndpoint',
  'databaseName',
  'clusterName'
];

properties.forEach(property => {
  this[property] = PropertiesService.getScriptProperties().getProperty(property);
});


const collectionName = Session.getActiveUser().getEmail();

function getAPIKey() {
  return PropertiesService.getScriptProperties().getProperty('API_KEY');
}

const iconUrgent = CardService.newIconImage()
    .setIconUrl(
        'https://iili.io/JQdUnII.png'
    )
    .setAltText('Urgent');
const iconSomewhatUrgent = CardService.newIconImage()
    .setIconUrl(
        'https://iili.io/JQdSMRp.png'
    )
    .setAltText('Somewhat Urgent');
const iconNotUrgent = CardService.newIconImage()
    .setIconUrl(
        'https://iili.io/JQdSHlf.png'
    )
    .setAltText('Not Urgent');

function onGmailMessage(e) {
  console.log(e);

  fetchAndStoreEmails(e);

  return fetchAndDisplayTasks(e);
}


function fetchAndStoreEmails(e) {
  const apikey = getAPIKey();
  const excludedEmail = "smarttasks.lmdify@gmail.com";
  
  let timeZone = e.commonEventObject.timeZone.id;
  const sevenDaysInMs = 604800000;
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - sevenDaysInMs);
  const dateQuery = Utilities.formatDate(sevenDaysAgo, timeZone, "yyyy/MM/dd");

  var threads = GmailApp.search("in:inbox after:" + dateQuery, 0, 10); // Get 10 most recent threads within 7 days from current time

  threads.forEach(thread => {
    const messages = thread.getMessages();
    const mostRecentMessage = messages[messages.length - 1]; // Get the last message in the thread

    if (mostRecentMessage.getFrom() !== excludedEmail) { // Exclude emails from the specified address
      const emailData = {
        subject: mostRecentMessage.getSubject(),
        sender: mostRecentMessage.getFrom(),
        body: mostRecentMessage.getPlainBody(),
        createdat: mostRecentMessage.getDate(),
        emailId: mostRecentMessage.getId(),
        processed: false
      };

      const payload = {
        document: emailData,
        collection: collectionName,
        database: databaseName,
        dataSource: clusterName
      };

      const options = {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        headers: { "api-key": apikey }
      };

      try {
        const response = UrlFetchApp.fetch(insertOneEndpoint, options);
        console.log("Email stored successfully");
      } catch (error) {
        Logger.log("Error inserting email: " + error);
      }
    }
  });
}


function fetchAndDisplayTasks(e, filter = "All") {
  const apikey = getAPIKey();

  let query = { hastask: true };

  if (filter === "Urgent") {
    query.urgency = "Urgent";
  } else if (filter === "Somewhat Urgent") {
    query.urgency = "Somewhat Urgent";
  } else if (filter === "Not Urgent") {
    query.urgency = "Not Urgent";
  }

  let accessToken = e.messageMetadata.accessToken;
  let messageId = e.messageMetadata.messageId;
  GmailApp.setCurrentMessageAccessToken(accessToken);
  let mailMessage = GmailApp.getMessageById(messageId);
  const currentEmailId = mailMessage.getId();

  if (currentEmailId) {
    query.emailId = { $ne: currentEmailId };
  }

  const sort = { createdat: -1 };
  const limit = 10; 

  const payload = {
    filter: query,
    sort: sort,
    limit: limit,
    collection: collectionName,
    database: databaseName,
    dataSource: clusterName
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    headers: { "api-key": apikey }
  };

  const response = UrlFetchApp.fetch(findEndpoint, options);
  const documents = JSON.parse(response.getContentText()).documents;

  return buildHomeCard(documents, e);
}



function buildHomeCard(documents = [], e) {

    let completedTasks = [];
    let uncompletedTasks = [];
    let urgency = "";
    let task = "";
    let sender = "";

    documents.forEach(document => {
        if (document.completed) {
        completedTasks.push(document);
        } else if (!document.completed) {
        uncompletedTasks.push(document);
        }
    });

    let refreshButtonAction = CardService.newAction()
        .setFunctionName('refreshCard')
        .setParameters({ "event": JSON.stringify(e) });

    let refreshButton = CardService.newTextButton()
        .setText('Refresh')
        .setOnClickAction(refreshButtonAction);

    let refreshFooter = CardService.newFixedFooter()
        .setPrimaryButton(refreshButton);

    let cardSection1 = CardService.newCardSection()
        .setHeader('Task from this Email');

    let currentEmailTask = fetchCurrentEmailTask(e);

    if (currentEmailTask == null) {
        cardSection1.addWidget(
            CardService.newTextParagraph().setText("No task found in this email.")
          );
    } else {
        urgency = currentEmailTask.urgency || "Unknown Urgency";
        task = currentEmailTask.task || "No Subject";
        sender = currentEmailTask.sender || "Unknown Sender";

        let icon = iconNotUrgent;
        if (urgency == "Urgent") {
            icon = iconUrgent;
        } else if (urgency == "Somewhat Urgent") {
            icon = iconSomewhatUrgent;
        }

        let taskWidget = CardService.newDecoratedText()
            .setTopLabel(urgency)
            .setText(task)
            .setBottomLabel(sender)
            .setStartIcon(icon)
            .setWrapText(true);

        if(!currentEmailTask.completed){
          let checkboxSwitchAction = CardService.newAction()
              .setFunctionName('toggleTaskComplete')
              .setParameters({ "document": JSON.stringify(currentEmailTask), "event": JSON.stringify(e) });

          let checkboxSwitch = CardService.newSwitch()
              .setControlType(CardService.SwitchControlType.CHECK_BOX)
              .setFieldName('toggleComplete' + currentEmailTask.emailId)
              .setValue('check')
              .setOnChangeAction(checkboxSwitchAction)
              .setSelected(false);
          taskWidget.setSwitchControl(checkboxSwitch);
        }
        
        let viewDetailsAction = CardService.newAction()
            .setFunctionName('buildDetailsCard')
            .setParameters({ "document": JSON.stringify(currentEmailTask), "event": JSON.stringify(e) });
    
        let viewDetailsButton = CardService.newTextButton()
            .setText('View Details')
            .setTextButtonStyle(CardService.TextButtonStyle.TEXT)
            .setOnClickAction(viewDetailsAction);

        let viewDetailsButtonList = CardService.newButtonSet()
            .addButton(viewDetailsButton);

        cardSection1.addWidget(taskWidget).addWidget(viewDetailsButtonList);
    }

    let buttonListAddTaskAction = CardService.newAction()
        .setFunctionName('addTaskCard')
        .setParameters({ "event": JSON.stringify(e) });

    let buttonListAddTask = CardService.newImageButton()
        .setIconUrl('https://iili.io/JQJXDzv.png')
        .setAltText('Add Task')
        .setOnClickAction(buttonListAddTaskAction);

    let buttonListFilterUrgentAction = CardService.newAction()
        .setFunctionName('filterByUrgency')
        .setParameters({ "filter": "Urgent", "event": JSON.stringify(e) });

    let buttonListFilterUrgent = CardService.newImageButton()
        .setIconUrl('https://iili.io/JQdUnII.png')
        .setAltText('Filter Urgent')
        .setOnClickAction(buttonListFilterUrgentAction);

    let buttonListFilterSomewhatUrgentAction = CardService.newAction()
        .setFunctionName('filterByUrgency')
        .setParameters({ "filter": "Somewhat Urgent", "event": JSON.stringify(e) });

    let buttonListFilterSomewhatUrgent = CardService.newImageButton()
        .setIconUrl('https://iili.io/JQdSMRp.png')
        .setAltText('Filter Somewhat Urgent')
        .setOnClickAction(buttonListFilterSomewhatUrgentAction);

    let buttonListFilterNotUrgentAction = CardService.newAction()
        .setFunctionName('filterByUrgency')
        .setParameters({ "filter": "Not Urgent", "event": JSON.stringify(e) });

    let buttonListFilterNotUrgent = CardService.newImageButton()
        .setIconUrl('https://iili.io/JQdSHlf.png')
        .setAltText('Filter Not Urgent')
        .setOnClickAction(buttonListFilterNotUrgentAction);

    let buttonListClearFilterAction = CardService.newAction()
        .setFunctionName('clearFilter')
        .setParameters({ "event": JSON.stringify(e) });

    let buttonListClearFilter = CardService.newImageButton()
        .setIconUrl('https://iili.io/JQJhyjj.png')
        .setAltText('Clear Filter')
        .setOnClickAction(buttonListClearFilterAction);

    let buttonList = CardService.newButtonSet()
        .addButton(buttonListAddTask)
        .addButton(buttonListFilterUrgent)
        .addButton(buttonListFilterSomewhatUrgent)
        .addButton(buttonListFilterNotUrgent)
        .addButton(buttonListClearFilter);

    let buttonListSection = CardService.newCardSection()
        .addWidget(buttonList);

    let cardSection3 = CardService.newCardSection()
        .setHeader('Tasks from other Emails');

    if (uncompletedTasks.length === 0) {
      cardSection3.addWidget(
        CardService.newTextParagraph().setText("No tasks found in other emails.")
      );
    } else { 
      uncompletedTasks.forEach(uncompletedTask => {
        urgency = uncompletedTask.urgency || "Unknown Urgency";
        task = uncompletedTask.task || "No Subject";
        sender = uncompletedTask.sender || "Unknown Sender";

        let icon = iconNotUrgent;
        if (urgency == "Urgent") {
          icon = iconUrgent;
        } else if (urgency == "Somewhat Urgent") {
          icon = iconSomewhatUrgent;
        }

        let checkboxSwitchAction = CardService.newAction()
          .setFunctionName('toggleTaskComplete')
          .setParameters({ "document": JSON.stringify(uncompletedTask), "event": JSON.stringify(e) });

        let checkboxSwitch = CardService.newSwitch()
          .setControlType(CardService.SwitchControlType.CHECK_BOX)
          .setFieldName('toggleComplete' + uncompletedTask.emailId)
          .setValue('check')
          .setOnChangeAction(checkboxSwitchAction)
          .setSelected(false);

        let taskWidget = CardService.newDecoratedText()
          .setTopLabel(urgency)
          .setText(task)
          .setBottomLabel(sender)
          .setStartIcon(icon)
          .setWrapText(true)
          .setSwitchControl(checkboxSwitch);

        let viewDetailsAction = CardService.newAction()
          .setFunctionName('buildDetailsCard')
          .setParameters({ "document": JSON.stringify(uncompletedTask), "event": JSON.stringify(e) });
    
        let viewDetailsButton = CardService.newTextButton()
            .setText('View Details')
            .setTextButtonStyle(CardService.TextButtonStyle.TEXT)
            .setOnClickAction(viewDetailsAction);

        let viewDetailsButtonList = CardService.newButtonSet()
            .addButton(viewDetailsButton);

        cardSection3.addWidget(taskWidget).addWidget(viewDetailsButtonList);
      });
    }

    let cardSection4 = CardService.newCardSection()
        .setHeader('Completed Tasks')
        .setCollapsible(true);

    if (completedTasks.length === 0) {
        cardSection4.addWidget(
          CardService.newTextParagraph().setText("No completed tasks.")
        );
      } else { 
          completedTasks.forEach(completedTask => {
          urgency = completedTask.urgency || "Unknown Urgency";
          task = completedTask.task || "No Subject";
          sender = completedTask.sender || "Unknown Sender";
  
          let icon = iconNotUrgent;
          if (urgency == "Urgent") {
            icon = iconUrgent;
          } else if (urgency == "Somewhat Urgent") {
            icon = iconSomewhatUrgent;
          }
  
          let taskWidget = CardService.newDecoratedText()
            .setTopLabel(urgency)
            .setText(task)
            .setBottomLabel(sender)
            .setStartIcon(icon)
            .setWrapText(true);

          let viewDetailsAction = CardService.newAction()
            .setFunctionName('buildDetailsCard')
            .setParameters({ "document": JSON.stringify(completedTask), "event": JSON.stringify(e) });
    
          let viewDetailsButton = CardService.newTextButton()
              .setText('View Details')
              .setTextButtonStyle(CardService.TextButtonStyle.TEXT)
              .setOnClickAction(viewDetailsAction);

          let viewDetailsButtonList = CardService.newButtonSet()
              .addButton(viewDetailsButton);
  
          cardSection4.addWidget(taskWidget).addWidget(viewDetailsButtonList);
        });
      }

    let card = CardService.newCardBuilder()
        .setFixedFooter(refreshFooter)
        .addSection(cardSection1)
        .addSection(buttonListSection)
        .addSection(cardSection3)
        .addSection(cardSection4)
        .build();

    return card;
}



function buildDetailsCard(e) {

    const document = JSON.parse(e.parameters.document);
    const event = JSON.parse(e.parameters.event);

    const formattedDeadline = document.deadline ? formatDate(document.deadline) : "";

    let completedButtonText = "Mark completed";
    if(document.completed){
        completedButtonText = "Mark uncompleted";
    }

    const taskBodyText = document.taskbody || ""; 

    let toggleCompleteButtonAction = CardService.newAction()
        .setFunctionName("toggleTaskComplete")
        .setParameters({ "document": JSON.stringify(document), "event": JSON.stringify(event) });

    let toggleCompleteButton = CardService.newTextButton()
        .setText(completedButtonText)
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor("#264653")
        .setOnClickAction(toggleCompleteButtonAction);

    let deleteButtonAction = CardService.newAction()
        .setFunctionName('deleteTaskCard')
        .setParameters({ "emailId": document.emailId, "event": JSON.stringify(event) });

    let deleteButton = CardService.newTextButton()
        .setText('Delete')
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor("#CE4257")
        .setOnClickAction(deleteButtonAction);

    let cardFooter = CardService.newFixedFooter()
        .setPrimaryButton(toggleCompleteButton)
        .setSecondaryButton(deleteButton);

    let buttonEditTaskAction = CardService.newAction()
        .setFunctionName('editTaskCard')
        .setParameters({ "document": JSON.stringify(document), "event": JSON.stringify(event) });

    let buttonEditTask = CardService.newImageButton()
        .setIconUrl('https://iili.io/JQJ0V3b.png')
        .setAltText('Edit Task')
        .setOnClickAction(buttonEditTaskAction);

    let icon = iconNotUrgent;
    if (document.urgency == "Urgent") {
        icon = iconUrgent;
    } else if (document.urgency == "Somewhat Urgent") {
        icon = iconSomewhatUrgent;
    }

    let widgetTask = CardService.newDecoratedText()
        .setTopLabel(document.urgency)
        .setText(document.task)
        .setBottomLabel(formattedDeadline)
        .setStartIcon(icon)
        .setWrapText(true)
        .setButton(buttonEditTask);

    // let widgetDeadline = CardService.newTextParagraph()
    //     .setText('Deadline: ' + formatDate(document.deadline));

    let widgetBodyTask = CardService.newTextParagraph()
        .setText(taskBodyText);

    let cardSection1 = CardService.newCardSection()
        .setHeader('Task')
        .addWidget(widgetTask)
        //.addWidget(widgetDeadline)
        .addWidget(widgetBodyTask);

    let iconSender = CardService.newIconImage()
        .setIcon(CardService.Icon.PERSON)
        .setAltText('Sender');

    let widgetSenderInfo = CardService.newDecoratedText()
        .setText(document.sender)
        .setStartIcon(iconSender)
        .setWrapText(true);

    let iconEmail = CardService.newIconImage()
        .setIcon(CardService.Icon.EMAIL)
        .setAltText('Email');

    let widgetDateSubject = CardService.newDecoratedText()
        .setTopLabel(formatDate(document.createdat))
        .setText(document.subject)
        .setStartIcon(iconEmail)
        .setWrapText(true);

    let widgetBodyEmail = CardService.newTextParagraph()
        .setText(document.body);

    let cardSection2 = CardService.newCardSection()
        .setHeader('From this Email')
        .addWidget(widgetSenderInfo)
        .addWidget(widgetDateSubject)
        .addWidget(widgetBodyEmail);

    let card = CardService.newCardBuilder()
        .setFixedFooter(cardFooter)
        .addSection(cardSection1)
        .addSection(cardSection2)
        .build();

    return card;
    
}



function toggleTaskComplete(e) {
  const document = JSON.parse(e.parameters.document);
  const event = JSON.parse(e.parameters.event);
  const taskId = document.emailId;

  const apikey = getAPIKey();

  const payload = {
    filter: { emailId: taskId },
    collection: collectionName,
    database: databaseName,
    dataSource: clusterName
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    headers: { "api-key": apikey }
  };

  const response = UrlFetchApp.fetch(findEndpoint, options);
  const fetchedTask = JSON.parse(response.getContentText()).documents[0];

  let newCompleted = !fetchedTask.completed;

  if(fetchedTask.completed === false){
    newCompleted = true;
  } else {
    newCompleted = false;
  }

  const updatePayload = {
      "filter": { emailId: taskId },
      "update": { "$set": { "completed": newCompleted } },
      "collection": collectionName,
      "database": databaseName,
      "dataSource": clusterName
      };

  const updateOptions = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(updatePayload),
    headers: { "api-key": apikey }
  };

  try {
    UrlFetchApp.fetch(updateOneEndpoint, updateOptions);
    console.log("Task status toggled in database");
  } catch (error) {
    console.error("Error updating task: ", error);
  }

  return CardService.newNavigation().updateCard(fetchAndDisplayTasks(event));
}



function addTaskCard(e) {
  const event = JSON.parse(e.parameters.event);

  let submitButtonAction = CardService.newAction()
      .setFunctionName('addTask')
      .setParameters({ "event": JSON.stringify(event) });

  let submitButton = CardService.newTextButton()
      .setText('Add Task')
      .setOnClickAction(submitButtonAction);

  let cardFooter = CardService.newFixedFooter()
      .setPrimaryButton(submitButton);
  
  const inputForm = CardService.newTextInput()
    .setFieldName('task')
    .setTitle('Task Headline')
    .setHint('Enter the name of the task');

  const descriptionForm = CardService.newTextInput()
    .setFieldName('taskbody')
    .setTitle('Task Description')
    .setHint('Enter a description of the task');

  // Calculate today's date at 12 am
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const defaultDeadline = today.getTime();

  const deadlineForm = CardService.newDateTimePicker()
    .setFieldName('deadline')
    .setTitle('Leave as is if no deadline')
    .setTimeZoneOffsetInMins(event.commonEventObject.timeZone.offset / 60000)
    .setValueInMsSinceEpoch(defaultDeadline);

  const urgencySelection = CardService.newSelectionInput()
    .setType(CardService.SelectionInputType.RADIO_BUTTON)
    .setFieldName('urgency')
    .addItem('Urgent', 'Urgent', false)
    .addItem('Somewhat Urgent', 'Somewhat Urgent', false)
    .addItem('Not Urgent', 'Not Urgent', true);

  const section1 = CardService.newCardSection()
    .setHeader('Add Task for this Email')
    .addWidget(inputForm)
    .addWidget(descriptionForm);
  
  const section2 = CardService.newCardSection()
    .setHeader('Deadline')
    .addWidget(deadlineForm);
  
  const section3 = CardService.newCardSection()
    .setHeader('Urgency Level')
    .addWidget(urgencySelection);

  const card = CardService.newCardBuilder()
    .setFixedFooter(cardFooter)
    .addSection(section1)
    .addSection(section2)
    .addSection(section3)
    .build();

  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(card))
    .build();
}


function addTask(e) {
  const event = JSON.parse(e.parameters.event);
  
  const apikey = getAPIKey();
  
  let accessToken = e.messageMetadata.accessToken;
  let messageId = e.messageMetadata.messageId;
  GmailApp.setCurrentMessageAccessToken(accessToken);
  let mailMessage = GmailApp.getMessageById(messageId);
  const taskId = mailMessage.getId();

  const task = e.formInput.task;
  const taskbody = e.formInput.taskbody;
  const deadline = new Date(e.formInput.deadline.msSinceEpoch);
  const urgency = e.formInput.urgency;

  // Check if the deadline is the default value
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const defaultDeadline = today.getTime();
  
  const taskData = {
    task,
    taskbody,
    urgency,
    completed: false,
    hastask: true,
    processed: true
  };

  // Only add the deadline if it is not the default value
  if (deadline.getTime() !== defaultDeadline) {
    taskData.deadline = deadline.toISOString();
  }

  const checkPayload = {
    "dataSource": clusterName,
    "database": databaseName,
    "collection": collectionName,
    "filter": { "emailId": taskId }
  };

  const checkOptions = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(checkPayload),
    headers: { "api-key": apikey }
  };

  let response = UrlFetchApp.fetch(findEndpoint, checkOptions);
  let result = JSON.parse(response.getContentText());

  if (result.documents && result.documents.length > 0) { // Email found, update the task
    const updatePayload = {
      "filter": { emailId: taskId },
      "update": { "$set": taskData },
      "collection": collectionName,
      "database": databaseName,
      "dataSource": clusterName
    };

    const updateOptions = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(updatePayload),
      headers: { "api-key": apikey }
    };

    UrlFetchApp.fetch(updateOneEndpoint, updateOptions);
    console.log("Task updated in database with associated email");

  } else { // Email not found, insert current email and task
    const insertPayload = {
      "dataSource": clusterName,
      "database": databaseName,
      "collection": collectionName,
      "document": {
        "emailId": taskId,
        "subject": mailMessage.getSubject(),
        "sender": mailMessage.getFrom(),
        "body": mailMessage.getPlainBody(),
        "createdat": mailMessage.getDate(),
        ...taskData
      }
    };

    const insertOptions = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(insertPayload),
      headers: { "api-key": apikey }
    };

    UrlFetchApp.fetch(insertOneEndpoint, insertOptions);
    console.log("New email and task inserted into database");
  }

  return CardService.newNavigation().updateCard(fetchAndDisplayTasks(event)); 
}


function editTaskCard(e) {
  const event = JSON.parse(e.parameters.event);
  const document = JSON.parse(e.parameters.document);

  let submitButtonAction = CardService.newAction()
      .setFunctionName('editTask')
      .setParameters({ "emailId": document.emailId, "event": JSON.stringify(event) });

  let submitButton = CardService.newTextButton()
      .setText('Edit Task')
      .setOnClickAction(submitButtonAction);

  let cardFooter = CardService.newFixedFooter()
      .setPrimaryButton(submitButton);

  // Handle null or undefined values with default values
  const taskValue = document.task || '';
  const taskBodyValue = document.taskbody || '';
  const deadlineValue = document.deadline ? Date.parse(document.deadline) : Date.now();
  const urgencyValue = document.urgency || 'Not Urgent';

  const inputForm = CardService.newTextInput()
    .setFieldName('task')
    .setTitle('Task Headline')
    .setHint('Enter the name of the task')
    .setValue(taskValue);

  const descriptionForm = CardService.newTextInput()
    .setFieldName('taskbody')
    .setTitle('Task Description')
    .setHint('Enter a description of the task')
    .setValue(taskBodyValue);

  const deadlineForm = CardService.newDateTimePicker()
    .setFieldName('deadline')
    .setTitle('Deadline')
    .setTimeZoneOffsetInMins(event.commonEventObject.timeZone.offset / 60000);
  
  if (deadlineValue) {
    deadlineForm.setValueInMsSinceEpoch(deadlineValue);
  }

  const urgencySelection = CardService.newSelectionInput()
    .setType(CardService.SelectionInputType.RADIO_BUTTON)
    .setTitle('Task Urgency')
    .setFieldName('urgency');

  const urgencyOptions = [
    { text: 'Urgent', value: 'Urgent' },
    { text: 'Somewhat Urgent', value: 'Somewhat Urgent' },
    { text: 'Not Urgent', value: 'Not Urgent' }
  ];

  urgencyOptions.forEach(option => {
    urgencySelection.addItem(option.text, option.value, option.value === urgencyValue);
  });

  const card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Edit Task'))
    .addSection(CardService.newCardSection()
      .addWidget(inputForm)
      .addWidget(descriptionForm)
      .addWidget(deadlineForm)
      .addWidget(urgencySelection))
    .setFixedFooter(cardFooter)
    .build();

  return card;
}



function editTask(e) {
  const event = JSON.parse(e.parameters.event);
  const taskId = e.parameters.emailId;

  const apikey = getAPIKey();

  const task = e.formInput.task;
  const taskbody = e.formInput.taskbody;
  const deadline = new Date(e.formInput.deadline.msSinceEpoch).toISOString();
  const urgency = e.formInput.urgency;

  const taskData = {
    task,
    taskbody,
    deadline,
    urgency,
    completed: false,
    hastask: true,
    processed: true
  };

  const updatePayload = {
      "filter": { emailId: taskId },
      "update": { "$set": taskData },
      "collection": collectionName,
      "database": databaseName,
      "dataSource": clusterName
      };

  const updateOptions = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(updatePayload),
    headers: { "api-key": apikey }
  };

  try {
    UrlFetchApp.fetch(updateOneEndpoint, updateOptions);
    console.log("Task inserted into database with associated email");
  } catch (error) {
    console.error("Error updating task: ", error);
  }

  return CardService.newNavigation().updateCard(fetchAndDisplayTasks(event));
}



function deleteTaskCard(e) {
    const emailId = e.parameters.emailId;
    const event = JSON.parse(e.parameters.event);

    let deleteButtonAction = CardService.newAction()
        .setFunctionName('deleteTask')
        .setParameters({ "emailId": emailId, "event": JSON.stringify(event) });

    let deleteButton = CardService.newTextButton()
        .setText('Delete')
        .setOnClickAction(deleteButtonAction);

    let cancelButtonAction = CardService.newAction()
        .setFunctionName('gotoPreviousCard')
        .setParameters({});

    let cancelButton = CardService.newTextButton()
        .setText('Cancel')
        .setOnClickAction(cancelButtonAction);

    let cardFooter = CardService.newFixedFooter()
        .setPrimaryButton(deleteButton)
        .setSecondaryButton(cancelButton);

    let deleteIcon = CardService.newIconImage()
        .setIconUrl('https://iili.io/JQJXFVV.png')
        .setAltText('Delete');

    let cardSection1DecoratedText1 = CardService.newDecoratedText()
        .setText('Delete Task')
        .setStartIcon(deleteIcon);

    let cardSection1 = CardService.newCardSection()
        .addWidget(cardSection1DecoratedText1);

    let askConfirmation = CardService.newTextParagraph()
        .setText('Are you sure you want to <font color=\"#FF0000\">delete</font> this task?');

    let cardSection2 = CardService.newCardSection()
        .addWidget(askConfirmation);

    let card = CardService.newCardBuilder()
        .setFixedFooter(cardFooter)
        .addSection(cardSection1)
        .addSection(cardSection2)
        .build();
    return card;
}



function deleteTask(e) {
  const taskToDelete = e.parameters.emailId;
  const event = JSON.parse(e.parameters.event);
  const apikey = getAPIKey();

  const deletePayload = {
    filter: { emailId: taskToDelete },
    collection: collectionName,
    database: databaseName,
    dataSource: clusterName
  };

  const deleteOptions = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(deletePayload),
    headers: { "api-key": apikey }
  };

  try {
    UrlFetchApp.fetch(deleteEndpoint, deleteOptions);
    console.log("Task deleted from database");
  } catch (error) {
    console.error("Error deleting task: ", error);
  }

  return CardService.newNavigation().updateCard(fetchAndDisplayTasks(event));
}



function fetchCurrentEmailTask(e) {
  const apikey = getAPIKey();

  let accessToken = e.messageMetadata.accessToken;
  let messageId = e.messageMetadata.messageId;
  GmailApp.setCurrentMessageAccessToken(accessToken);
  let mailMessage = GmailApp.getMessageById(messageId);
  const currentEmailId = mailMessage.getId();

  const query = {
    emailId: currentEmailId,
    hastask: true
  }; 

  const payload = {
    filter: query,
    collection: collectionName,
    database: databaseName,
    dataSource: clusterName
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    headers: { "api-key": apikey }
  };

  try {
    const response = UrlFetchApp.fetch(findEndpoint, options);
    const currentEmailDocument = JSON.parse(response.getContentText()).documents[0];

    if (currentEmailDocument.length === 0) {
      return null;
    } else {
      return currentEmailDocument;
    }
  } catch (error) {
    console.error("Error fetching tasks:", error);
  } 
}



function formatDate(dateString) {
  const date = new Date(dateString);

  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();

  let hours = date.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  const minutes = String(date.getMinutes()).padStart(2, '0'); 

  return `${month}-${day}-${year} ${hours}:${minutes} ${ampm}`;
}

function filterByUrgency(e) {
  const filter = e.parameters.filter;
  const event = JSON.parse(e.parameters.event);

  return CardService.newNavigation().updateCard(fetchAndDisplayTasks(event, filter));
}

function clearFilter(e) {
  const event = JSON.parse(e.parameters.event);

  return CardService.newNavigation().updateCard(fetchAndDisplayTasks(event));
}

function refreshCard(e) {
  const event = JSON.parse(e.parameters.event);

  return CardService.newNavigation().updateCard(fetchAndDisplayTasks(event));
}
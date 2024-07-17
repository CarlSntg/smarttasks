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

/**
 * Gets the API key from script properties.
 * @returns {string} The API key.
 */
function getAPIKey() {
  return PropertiesService.getScriptProperties().getProperty('API_KEY');
}

const iconUrgent = CardService.newIconImage()
    .setIconUrl('https://iili.io/JQdUnII.png')
    .setAltText('Urgent');
const iconSomewhatUrgent = CardService.newIconImage()
    .setIconUrl('https://iili.io/JQdSMRp.png')
    .setAltText('Somewhat Urgent');
const iconNotUrgent = CardService.newIconImage()
    .setIconUrl('https://iili.io/JQdSHlf.png')
    .setAltText('Not Urgent');

/**
 * Event handler for Gmail message.
 * @param {Object} e - The event object.
 * @returns {Object} The card to display tasks.
 */
function onGmailMessage(e) {
  console.log(e);

  fetchAndStoreEmails(e);
  return fetchAndDisplayTasks(e, 0, "All"); // Start with the first page and no filter
}

/**
 * Fetches and stores emails in the database.
 * @param {Object} e - The event object.
 */
function fetchAndStoreEmails(e) {
  const apikey = getAPIKey();
  const excludedEmail = "smarttasks.lmdify@gmail.com";

  let timeZone = Session.getScriptTimeZone();
  const fourteenDaysInMs = 86400000 * 14;
  const now = new Date();
  const fourteenDaysAgo = new Date(now.getTime() - fourteenDaysInMs);
  const dateQuery = Utilities.formatDate(fourteenDaysAgo, timeZone, "yyyy/MM/dd");

  var threads = GmailApp.search("in:inbox category:primary after:" + dateQuery, 0, 50);

  threads.forEach(thread => {
    const messages = thread.getMessages();
    const mostRecentMessage = messages[messages.length - 1];

    if (mostRecentMessage.getFrom() !== excludedEmail) {
      const emailId = mostRecentMessage.getId();
      const checkPayload = {
        filter: { emailId: emailId },
        collection: collectionName,
        database: databaseName,
        dataSource: clusterName
      };

      const checkOptions = {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(checkPayload),
        headers: { "api-key": apikey }
      };

      try {
        const checkResponse = UrlFetchApp.fetch(findEndpoint, checkOptions);
        const checkResult = JSON.parse(checkResponse.getContentText());

        if (!checkResult.document) {
          const emailData = {
            subject: mostRecentMessage.getSubject(),
            sender: mostRecentMessage.getFrom(),
            body: mostRecentMessage.getPlainBody(),
            createdat: mostRecentMessage.getDate(),
            emailId: emailId,
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
        } else {
          console.log("Email already exists, skipping insertion");
        }
      } catch (error) {
        Logger.log("Error checking email existence: " + error);
      }
    }
  });
}

/**
 * Fetches and displays tasks.
 * @param {Object} e - The event object.
 * @param {number} [page=0] - The page number.
 * @param {string} [filter="All"] - The filter to apply.
 * @returns {Object} The card to display tasks.
 */
function fetchAndDisplayTasks(e, page = 0, filter = "All") {
  const apikey = getAPIKey();
  const tasksPerPage = 7;
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
  const skip = page * tasksPerPage;

  const payload = {
    filter: query,
    sort: sort,
    limit: tasksPerPage,
    skip: skip,
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

  return buildHomeCard(documents, e, page, filter, documents.length < tasksPerPage);
}

/**
 * Builds the home card with tasks.
 * @param {Array} documents - The documents to display.
 * @param {Object} e - The event object.
 * @param {number} page - The page number.
 * @param {string} filter - The filter to apply.
 * @param {boolean} noMoreTasks - Whether there are more tasks to display.
 * @returns {Object} The home card.
 */
function buildHomeCard(documents = [], e, page, filter, noMoreTasks) {
  const apikey = getAPIKey();
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

  const payload = {
    filter: { emailId: 'trigger' },
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
  const triggered = JSON.parse(response.getContentText()).documents[0]?.triggered || false;

  let notificationSection;
  if (!triggered) {
    notificationSection = CardService.newCardSection()
        .addWidget(CardService.newTextParagraph().setText('Welcome to <b><font color=\"#264653\">SmartTasks!</font></b>\n\nCreating a trigger is essential for the functionalities of this add-on, please click the <b>Run Trigger</b> button down at the bottom to get started.'));
  }

  let triggerButton;
  if (triggered) {
    const deleteTriggerButtonAction = CardService.newAction()
        .setFunctionName('showDeleteTriggerConfirmation')
        .setParameters({ "event": JSON.stringify(e) });

    triggerButton = CardService.newTextButton()
        .setText('Delete Trigger')
        .setOnClickAction(deleteTriggerButtonAction);
  } else {
    const createTriggerButtonAction = CardService.newAction()
        .setFunctionName('showCreateTriggerConfirmation')
        .setParameters({ "event": JSON.stringify(e) });

    triggerButton = CardService.newTextButton()
        .setText('Run Trigger')
        .setOnClickAction(createTriggerButtonAction);
  }

  let refreshButtonAction = CardService.newAction()
      .setFunctionName('refreshCard')
      .setParameters({ "event": JSON.stringify(e), "filter": filter, "page": page.toString() });

  let refreshButton = CardService.newTextButton()
      .setText('Refresh')
      .setOnClickAction(refreshButtonAction);

  let refreshFooter = CardService.newFixedFooter()
      .setPrimaryButton(refreshButton)
      .setSecondaryButton(triggerButton);

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
        .setTextButtonStyle(CardService.TextButtonStyle.OUTLINED)
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
      .setParameters({ "filter": "Urgent", "event": JSON.stringify(e), "page": "0" });

  let buttonListFilterUrgent = CardService.newImageButton()
      .setIconUrl('https://iili.io/JQdUnII.png')
      .setAltText('Filter Urgent')
      .setOnClickAction(buttonListFilterUrgentAction);

  let buttonListFilterSomewhatUrgentAction = CardService.newAction()
      .setFunctionName('filterByUrgency')
      .setParameters({ "filter": "Somewhat Urgent", "event": JSON.stringify(e), "page": "0" });

  let buttonListFilterSomewhatUrgent = CardService.newImageButton()
      .setIconUrl('https://iili.io/JQdSMRp.png')
      .setAltText('Filter Somewhat Urgent')
      .setOnClickAction(buttonListFilterSomewhatUrgentAction);

  let buttonListFilterNotUrgentAction = CardService.newAction()
      .setFunctionName('filterByUrgency')
      .setParameters({ "filter": "Not Urgent", "event": JSON.stringify(e), "page": "0" });

  let buttonListFilterNotUrgent = CardService.newImageButton()
      .setIconUrl('https://iili.io/JQdSHlf.png')
      .setAltText('Filter Not Urgent')
      .setOnClickAction(buttonListFilterNotUrgentAction);

  let buttonListClearFilterAction = CardService.newAction()
      .setFunctionName('clearFilter')
      .setParameters({ "event": JSON.stringify(e), "page": "0" });

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
      CardService.newTextParagraph().setText("No tasks found in other emails.\n\nIf you have recently added or expect tasks, please give it a minute and refresh the page.")
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
          .setTextButtonStyle(CardService.TextButtonStyle.OUTLINED)
          .setOnClickAction(viewDetailsAction);

      let viewDetailsButtonList = CardService.newButtonSet()
          .addButton(viewDetailsButton);

      cardSection3.addWidget(taskWidget).addWidget(viewDetailsButtonList);
    });
  }

  let pageButtonSet = CardService.newButtonSet();

  // Previous Page Button
  if (page > 0) {
    let prevPageButtonAction = CardService.newAction()
        .setFunctionName('fetchPrevPage')
        .setParameters({ "page": (page - 1).toString(), "event": JSON.stringify(e), "filter": filter });

    let prevPageButton = CardService.newImageButton()
        .setIconUrl('https://iili.io/dH9djWJ.png')
        .setAltText('Previous Page')
        .setOnClickAction(prevPageButtonAction);

    pageButtonSet.addButton(prevPageButton);
  }

  // Next Page Button
  if (!noMoreTasks) {
    let nextPageButtonAction = CardService.newAction()
        .setFunctionName('fetchNextPage')
        .setParameters({ "page": (page + 1).toString(), "event": JSON.stringify(e), "filter": filter });

    let nextPageButton = CardService.newImageButton()
        .setIconUrl('https://iili.io/dH9dUOX.png')
        .setAltText('Next Page')
        .setOnClickAction(nextPageButtonAction);

    pageButtonSet.addButton(nextPageButton);
  }

  cardSection3.addWidget(pageButtonSet);

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
            .setTextButtonStyle(CardService.TextButtonStyle.OUTLINED)
            .setOnClickAction(viewDetailsAction);

        let viewDetailsButtonList = CardService.newButtonSet()
            .addButton(viewDetailsButton);

        cardSection4.addWidget(taskWidget).addWidget(viewDetailsButtonList);
      });
    }

  let card;
  if (notificationSection) {
    card = CardService.newCardBuilder()
      .setName('homeCard')
      .setFixedFooter(refreshFooter)
      .addSection(notificationSection)
      .addSection(cardSection1)
      .addSection(buttonListSection)
      .addSection(cardSection3)
      .addSection(cardSection4)
      .build();
  } else {
    card = CardService.newCardBuilder()
      .setName('homeCard')
      .setFixedFooter(refreshFooter)
      .addSection(cardSection1)
      .addSection(buttonListSection)
      .addSection(cardSection3)
      .addSection(cardSection4)
      .build();
  }

  return card;
}

/**
 * Fetches the next page of tasks.
 * @param {Object} e - The event object.
 * @returns {Object} The updated card navigation.
 */
function fetchNextPage(e) {
  const page = parseInt(e.parameters.page, 10);
  const filter = e.parameters.filter;
  const event = JSON.parse(e.parameters.event);

  return CardService.newNavigation().updateCard(fetchAndDisplayTasks(event, page, filter));
}

/**
 * Fetches the previous page of tasks.
 * @param {Object} e - The event object.
 * @returns {Object} The updated card navigation.
 */
function fetchPrevPage(e) {
  const page = parseInt(e.parameters.page, 10);
  const filter = e.parameters.filter;
  const event = JSON.parse(e.parameters.event);

  return CardService.newNavigation().updateCard(fetchAndDisplayTasks(event, page, filter));
}

/**
 * Builds a card with detailed task information.
 * @param {Object} e - The event object.
 * @returns {Object} The detailed task card.
 */
function buildDetailsCard(e) {
  const document = JSON.parse(e.parameters.document);
  const event = JSON.parse(e.parameters.event);

  const formattedDeadline = document.deadline ? formatDate(document.deadline) : "";

  let completedButtonText = "Mark completed";
  if(document.completed){
    completedButtonText = "Uncompleted";
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

  let widgetBodyTask = CardService.newTextParagraph()
      .setText(taskBodyText);

  let cardSection1 = CardService.newCardSection()
      .setHeader('Task')
      .addWidget(widgetTask)
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

/**
 * Toggles the completion status of a task.
 * @param {Object} e - The event object.
 * @returns {Object} The updated card navigation.
 */
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

/**
 * Builds a card to add a new task.
 * @param {Object} e - The event object.
 * @returns {Object} The card to add a new task.
 */
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

/**
 * Adds a new task to the database.
 * @param {Object} e - The event object.
 * @returns {Object} The updated card navigation.
 */
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

  if (result.documents && result.documents.length > 0) {
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

  } else {
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

/**
 * Builds a card to edit an existing task.
 * @param {Object} e - The event object.
 * @returns {Object} The card to edit a task.
 */
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

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const defaultDeadline = today.getTime();

  const taskValue = document.task || '';
  const taskBodyValue = document.taskbody || '';
  const deadlineValue = document.deadline ? Date.parse(document.deadline) : defaultDeadline;
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

  // const deadlineForm = CardService.newDatePicker()
  //   .setTitle("Deadline")
  //   .setFieldName("deadline");
  
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

/**
 * Edits an existing task in the database.
 * @param {Object} e - The event object.
 * @returns {Object} The updated card navigation.
 */
function editTask(e) {
  const event = JSON.parse(e.parameters.event);
  const taskId = e.parameters.emailId;

  const apikey = getAPIKey();

  const task = e.formInput.task;
  const taskbody = e.formInput.taskbody;
  const deadline = new Date(e.formInput.deadline.msSinceEpoch)
  const urgency = e.formInput.urgency;

  const taskData = {
    task,
    taskbody,
    urgency,
    completed: false,
    hastask: true,
    processed: true
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const defaultDeadline = today.getTime();

  if (deadline.getTime() !== defaultDeadline) {
    taskData.deadline = deadline.toISOString();
  }

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
    console.log("Task updated in database with associated email");
  } catch (error) {
    console.error("Error updating task: ", error);
  }

  const fetchPayload = {
    filter: { emailId: taskId },
    collection: collectionName,
    database: databaseName,
    dataSource: clusterName
  };

  const fetchOptions = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(fetchPayload),
    headers: { "api-key": apikey }
  };

  let updatedDocument;
  try {
    const response = UrlFetchApp.fetch(findEndpoint, fetchOptions);
    const documents = JSON.parse(response.getContentText()).documents;
    if (documents.length > 0) {
      updatedDocument = documents[0];
    } else {
      console.error("No document found with the provided emailId");
      return CardService.newNavigation().updateCard(fetchAndDisplayTasks(event));
    }
  } catch (error) {
    console.error("Error fetching updated task:", error);
    return CardService.newNavigation().updateCard(fetchAndDisplayTasks(event));
  }

  return CardService.newNavigation().updateCard(buildDetailsCard({ parameters: { document: JSON.stringify(updatedDocument), event: JSON.stringify(event) } }));
}

/**
 * Builds a card to confirm task deletion.
 * @param {Object} e - The event object.
 * @returns {Object} The card to confirm task deletion.
 */
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

/**
 * Deletes a task from the database.
 * @param {Object} e - The event object.
 * @returns {Object} The updated card navigation.
 */
function deleteTask(e) {
  const taskToUpdate = e.parameters.emailId;
  const event = JSON.parse(e.parameters.event);
  const apikey = getAPIKey();

  const updatePayload = {
    filter: { emailId: taskToUpdate },
    update: {
      $unset: {
        subject: "",
        sender: "",
        body: "",
        createdat: "",
        task: "",
        taskbody: "",
        deadline: "",
        urgency: "",
        completed: "",
      },
      $set: {
        hastask: false,
        processed: true
      }
    },
    collection: collectionName,
    database: databaseName,
    dataSource: clusterName
  };

  const updateOptions = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(updatePayload),
    headers: { "api-key": apikey }
  };

  try {
    UrlFetchApp.fetch(updateOneEndpoint, updateOptions);
    console.log("Task updated to remove fields and set hastask to false");
  } catch (error) {
    console.error("Error updating task: ", error);
  }

  return CardService.newNavigation().updateCard(fetchAndDisplayTasks(event));
}

/**
 * Fetches the current email task.
 * @param {Object} e - The event object.
 * @returns {Object|null} The task document or null if not found.
 */
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

/**
 * Formats a date string to a readable format.
 * @param {string} dateString - The date string to format.
 * @returns {string} The formatted date string.
 */
function formatDate(dateString) {
  const date = new Date(dateString);

  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();

  let hours = date.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  const minutes = String(date.getMinutes()).padStart(2, '0'); 

  // return `${month}-${day}-${year} ${hours}:${minutes} ${ampm}`;
  return `${month}-${day}-${year}`;
}

/**
 * Filters tasks by urgency.
 * @param {Object} e - The event object.
 * @returns {Object} The updated card navigation.
 */
function filterByUrgency(e) {
  const filter = e.parameters.filter;
  const event = JSON.parse(e.parameters.event);

  return CardService.newNavigation().updateCard(fetchAndDisplayTasks(event, 0, filter));
}

/**
 * Clears the task filter.
 * @param {Object} e - The event object.
 * @returns {Object} The updated card navigation.
 */
function clearFilter(e) {
  const event = JSON.parse(e.parameters.event);

  return CardService.newNavigation().updateCard(fetchAndDisplayTasks(event, 0, "All"));
}

/**
 * Refreshes the current card.
 * @param {Object} e - The event object.
 * @returns {Object} The updated card navigation.
 */
function refreshCard(e) {
  const page = parseInt(e.parameters.page, 10);
  const filter = e.parameters.filter;
  const event = JSON.parse(e.parameters.event);

  return CardService.newNavigation().updateCard(fetchAndDisplayTasks(event, page, filter));
}

/**
 * Navigates to the previous card.
 * @returns {Object} The navigation action response.
 */
function gotoPreviousCard() {
  var nav = CardService.newNavigation().popCard();
  return CardService.newActionResponseBuilder()
      .setNavigation(nav)
      .build();
}

/**
 * Shows a confirmation card for creating a trigger.
 * @param {Object} e - The event object.
 * @returns {Object} The confirmation card.
 */
function showCreateTriggerConfirmation(e) {
  const event = JSON.parse(e.parameters.event);

  const createTriggerButtonAction = CardService.newAction()
      .setFunctionName('createTrigger')
      .setParameters({ "event": JSON.stringify(event) });

  const createTriggerButton = CardService.newTextButton()
      .setText('Create Trigger')
      .setOnClickAction(createTriggerButtonAction);

  const cancelButtonAction = CardService.newAction()
      .setFunctionName('gotoPreviousCard');

  const cancelButton = CardService.newTextButton()
      .setText('Cancel')
      .setOnClickAction(cancelButtonAction);

  const cardFooter = CardService.newFixedFooter()
      .setPrimaryButton(createTriggerButton)
      .setSecondaryButton(cancelButton);

  let createTriggerIcon = CardService.newIconImage()
      .setIconUrl('https://iili.io/Jp4NJBn.png')
      .setAltText('Create Trigger');

  let createTrigger = CardService.newDecoratedText()
      .setText('Create Trigger')
      .setStartIcon(createTriggerIcon);

  let cardSection1 = CardService.newCardSection()
      .addWidget(createTrigger);

  let askConfirmation = CardService.newTextParagraph()
      .setText('This will initiate the upload and processing of your emails for task extraction. This is <b>necessary</b> for the functionality of the addon and runs at intervals. Create the trigger?\n\nPlease review our <a href=\"https://docs.google.com/document/d/e/2PACX-1vThgejgFkRr-Gfg-PdAPksWeNRPVhxWinEgd6LqzeEipsp_MB8sQIGy7SYhWZTqWVdyPi-PwBWoJh4O/pub\">Terms of Service</a> and <a href=\"https://docs.google.com/document/d/e/2PACX-1vRkCmVUi7_n5VBV3PDtDQcZPkb-1Tmu04DDGEmME5_xpk5fFWKOeZcEsQbn9yOaGGtIv6Nt-kPT2iEX/pub\">Privacy Policy</a> before proceeding.\n\n<b>Please note:</b>\nRunning this trigger might take up to a minute to finish. You only need to do this once.');

  let cardSection2 = CardService.newCardSection()
      .addWidget(askConfirmation);

  let card = CardService.newCardBuilder()
      .setFixedFooter(cardFooter)
      .addSection(cardSection1)
      .addSection(cardSection2)
      .build();

  return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().pushCard(card))
      .build();
}

/**
 * Shows a confirmation card for deleting a trigger.
 * @param {Object} e - The event object.
 * @returns {Object} The confirmation card.
 */
function showDeleteTriggerConfirmation(e) {
  const event = JSON.parse(e.parameters.event);

  const deleteTriggerButtonAction = CardService.newAction()
      .setFunctionName('deleteTrigger')
      .setParameters({ "event": JSON.stringify(event) });

  const deleteTriggerButton = CardService.newTextButton()
      .setText('Delete Trigger')
      .setOnClickAction(deleteTriggerButtonAction);

  const cancelButtonAction = CardService.newAction()
      .setFunctionName('gotoPreviousCard');

  const cancelButton = CardService.newTextButton()
      .setText('Cancel')
      .setOnClickAction(cancelButtonAction);

  const cardFooter = CardService.newFixedFooter()
      .setPrimaryButton(deleteTriggerButton)
      .setSecondaryButton(cancelButton);

  let deleteTriggerIcon = CardService.newIconImage()
      .setIconUrl('https://iili.io/Jp4N7pV.png')
      .setAltText('Delete Trigger');

  let deleteTrigger = CardService.newDecoratedText()
      .setText('Delete Trigger')
      .setStartIcon(deleteTriggerIcon);

  let cardSection1 = CardService.newCardSection()
      .addWidget(deleteTrigger);

  let askConfirmation = CardService.newTextParagraph()
      .setText('This will <b><font color=\"#FF0000\">stop</font></b> the upload and processing of your emails for task extraction, which is necessary for the functionality of the addon. Delete the trigger?');

  let cardSection2 = CardService.newCardSection()
      .addWidget(askConfirmation);

  let card = CardService.newCardBuilder()
      .setFixedFooter(cardFooter)
      .addSection(cardSection1)
      .addSection(cardSection2)
      .build();

  return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().pushCard(card))
      .build();
}

/**
 * Creates a trigger for fetching and storing emails.
 * @param {Object} e - The event object.
 * @returns {Object} The updated card navigation.
 */
function createTrigger(e) {
  const apikey = getAPIKey();
  const collection = collectionName;

  fetchAndStoreEmails();

  const payload = {
    filter: { emailId: 'trigger' },
    update: { 
      $set: { 
        triggered: true,
        hastask: false,
        processed: true
      }
    },
    upsert: true,
    collection: collection,
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
    const response = UrlFetchApp.fetch(updateOneEndpoint, options);
    ScriptApp.newTrigger('fetchAndStoreEmails')
             .timeBased()
             .everyHours(1)
             .create();
    console.log("Trigger created successfully");
  } catch (error) {
    Logger.log("Error creating trigger: " + error);
  }

  return CardService.newNavigation().updateCard(fetchAndDisplayTasks(e));
}

/**
 * Deletes the trigger for fetching and storing emails.
 * @param {Object} e - The event object.
 * @returns {Object} The updated card navigation.
 */
function deleteTrigger(e) {
  const apikey = getAPIKey();
  const collection = collectionName;

  const payload = {
    filter: { emailId: 'trigger' },
    update: { 
      $set: { 
        triggered: false,
        hastask: false,
        processed: true
      }
    },
    collection: collection,
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
    const response = UrlFetchApp.fetch(updateOneEndpoint, options);
    const triggers = ScriptApp.getProjectTriggers();
    for (const trigger of triggers) {
      if (trigger.getHandlerFunction() == 'fetchAndStoreEmails') {
        ScriptApp.deleteTrigger(trigger);
      }
    }
    console.log("Trigger deleted successfully");
  } catch (error) {
    Logger.log("Error deleting trigger: " + error);
  }

  return CardService.newNavigation().updateCard(fetchAndDisplayTasks(e));
}

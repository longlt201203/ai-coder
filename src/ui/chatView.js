
const vscode = acquireVsCodeApi();
const messagesContainer = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const contextItemsContainer = document.getElementById('contextItems');
const addContextBtn = document.getElementById('addContextBtn');
const clearContextBtn = document.getElementById('clearContextBtn');

// Send message function
function sendMessage() {
    const message = messageInput.value.trim();
    if (message) {
        vscode.postMessage({ type: 'sendMessage', message });
        messageInput.value = '';
    }
}

// Event listeners
sendButton.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

// Markdown formatting using marked.js
function formatText(text) {
    // Configure marked options
    marked.setOptions({
        breaks: true,        // Add line breaks on single newlines
        gfm: true,           // Use GitHub Flavored Markdown
        headerIds: false,    // Don't add IDs to headers
        langPrefix: 'language-', // CSS language prefix for code blocks
        highlight: function (code, lang) {
            // Use highlight.js for syntax highlighting
            if (lang && hljs.getLanguage(lang)) {
                try {
                    return hljs.highlight(code, { language: lang }).value;
                } catch (err) {
                    console.error('Highlight.js error:', err);
                }
            }
            
            // Fallback to auto-detection if language is not specified or not supported
            try {
                return hljs.highlightAuto(code).value;
            } catch (err) {
                console.error('Highlight.js auto-detection error:', err);
            }
            
            // Return the original code if highlighting fails
            return code;
        }
    });

    // Process the text with marked
    const html = marked.parse(text);

    // Add copy buttons to code blocks
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;

    // Process each code block to add copy buttons
    tempDiv.querySelectorAll('pre code').forEach(codeBlock => {
        const pre = codeBlock.parentNode;
        
        // Create copy button
        const copyButton = document.createElement('button');
        copyButton.className = 'copy-code-button';
        copyButton.textContent = 'Copy';
        copyButton.addEventListener('click', () => {
            const code = codeBlock.textContent;
            navigator.clipboard.writeText(code).then(() => {
                copyButton.textContent = 'Copied!';
                setTimeout(() => {
                    copyButton.textContent = 'Copy';
                }, 2000);
            });
        });
        
        pre.appendChild(copyButton);
        
        // Ensure the code block has hljs class
        if (!codeBlock.classList.contains('hljs')) {
            hljs.highlightElement(codeBlock);
        }
    });

    return tempDiv.innerHTML;
}

// Handle context item updates from extension
// Update context items display
function updateContextItems(items) {
    console.log('Updating context items in UI:', items);
    const contextItemsContainer = document.getElementById('contextItems');

    if (!items || items.length === 0) {
        contextItemsContainer.innerHTML = '<div class="empty-context">No context items selected</div>';
        return;
    }

    // Create a Set to track unique paths and avoid duplicates
    const uniquePaths = new Set();
    let html = '';

    for (const item of items) {
        // Skip if we've already added this path
        if (uniquePaths.has(item.path)) {
            continue;
        }

        uniquePaths.add(item.path);

        let iconClass = '';

        if (item.isDirectory) {
            iconClass = 'fa-solid fa-folder';
        } else {
            // Get file extension
            const extension = item.name.split('.').pop().toLowerCase();

            // Use the same simplified approach as in updateFileList
            switch (extension) {
                case 'js':
                    iconClass = 'fa-brands fa-js';
                    break;
                case 'ts':
                    iconClass = 'fa-solid fa-code ts-file';
                    break;
                case 'html':
                    iconClass = 'fa-brands fa-html5';
                    break;
                case 'css':
                    iconClass = 'fa-brands fa-css3-alt';
                    break;
                case 'json':
                    iconClass = 'fa-solid fa-brackets-curly';
                    break;
                case 'md':
                    iconClass = 'fa-solid fa-file-lines md-file';
                    break;
                case 'py':
                    iconClass = 'fa-brands fa-python';
                    break;
                case 'csv':
                    iconClass = 'fa-solid fa-table csv-file';
                    break;
                case 'txt':
                    iconClass = 'fa-solid fa-file-lines';
                    break;
                default:
                    iconClass = 'fa-solid fa-file';
            }
        }

        html += `
            <div class="context-item" data-path="${item.path}">
                <span class="context-item-icon ${iconClass}"></span>
                <span class="context-item-name" title="${item.path}">${item.name}</span>
                <span class="context-item-remove fa-solid fa-xmark" title="Remove from context"></span>
            </div>
        `;
    }

    contextItemsContainer.innerHTML = html;

    // Add event listeners to remove buttons
    document.querySelectorAll('.context-item-remove').forEach(button => {
        button.addEventListener('click', (e) => {
            const item = e.target.closest('.context-item');
            const path = item.dataset.path;
            vscode.postMessage({
                type: 'contextAction',
                action: 'remove',
                path: path
            });
            e.stopPropagation();
        });
    });
}

// Update the file list in the UI
function updateFileList(items) {
    fileListElement.innerHTML = '';

    items.forEach(item => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        fileItem.dataset.path = item.path;
        fileItem.dataset.isDirectory = item.isDirectory;

        if (selectedItems.has(item.path)) {
            fileItem.classList.add('selected');
        }

        const icon = document.createElement('span');

        // Set appropriate icon based on file type
        if (item.isDirectory) {
            icon.className = 'file-item-icon fa-solid fa-folder';
        } else {
            // Get file extension
            const extension = item.name.split('.').pop().toLowerCase();

            // Use a simpler approach with fewer icon types but more reliable
            switch (extension) {
                case 'js':
                    icon.className = 'file-item-icon fa-brands fa-js';
                    break;
                case 'ts':
                    icon.className = 'file-item-icon fa-solid fa-code ts-file';
                    break;
                case 'html':
                    icon.className = 'file-item-icon fa-brands fa-html5';
                    break;
                case 'css':
                    icon.className = 'file-item-icon fa-brands fa-css3-alt';
                    break;
                case 'json':
                    icon.className = 'file-item-icon fa-solid fa-brackets-curly';
                    break;
                case 'md':
                    icon.className = 'file-item-icon fa-solid fa-file-lines md-file';
                    break;
                case 'py':
                    icon.className = 'file-item-icon fa-brands fa-python';
                    break;
                case 'csv':
                    icon.className = 'file-item-icon fa-solid fa-table csv-file';
                    break;
                case 'txt':
                    icon.className = 'file-item-icon fa-solid fa-file-lines';
                    break;
                default:
                    icon.className = 'file-item-icon fa-solid fa-file';
            }
        }

        const name = document.createElement('span');
        name.textContent = item.name;

        fileItem.appendChild(icon);
        fileItem.appendChild(name);

        // Add click handler
        fileItem.addEventListener('click', (e) => {
            if (item.isDirectory && e.detail === 2) {
                // Double click on directory - navigate into it
                navigateToDirectory(item.path);
            } else {
                // Single click - select/deselect
                if (selectedItems.has(item.path)) {
                    selectedItems.delete(item.path);
                    fileItem.classList.remove('selected');
                } else {
                    selectedItems.add(item.path);
                    fileItem.classList.add('selected');
                }
                updateSelectedItemsCount();
            }
        });

        fileListElement.appendChild(fileItem);
    });
}

// Add context button click handler
addContextBtn.addEventListener('click', () => {
    // Show our custom file browser instead of sending a message to VS Code
    showFileBrowser();
});

// Clear context button click handler
clearContextBtn.addEventListener('click', () => {
    vscode.postMessage({
        type: 'contextAction',
        action: 'clear'
    });
});

// File browser state
let currentPath = '';

// File browser elements
const fileBrowserDialog = document.getElementById('fileBrowserDialog');
const currentPathElement = document.getElementById('currentPath');
const fileListElement = document.getElementById('fileList');
const selectedItemsCountElement = document.getElementById('selectedItemsCount');
const upDirBtn = document.getElementById('upDirBtn');
const homeBtn = document.getElementById('homeBtn');
const selectAllBtn = document.getElementById('selectAllBtn');
const closeBrowserBtn = document.getElementById('closeBrowserBtn');
const cancelSelectBtn = document.getElementById('cancelSelectBtn');
const confirmSelectBtn = document.getElementById('confirmSelectBtn');

// Create modal overlay
const modalOverlay = document.createElement('div');
modalOverlay.className = 'modal-overlay';
document.body.appendChild(modalOverlay);

// Selected items set
const selectedItems = new Set();

// Show file browser
function showFileBrowser() {
    // Clear any previously selected items
    selectedItems.clear();
    updateSelectedItemsCount();

    // Show the dialog and overlay
    fileBrowserDialog.classList.add('active');
    modalOverlay.classList.add('active');

    // Request initial directory listing (workspace root)
    vscode.postMessage({
        type: 'fileBrowser',
        action: 'listDirectory',
        path: ''  // Empty path means get workspace root
    });
}

// Hide file browser
function hideFileBrowser() {
    fileBrowserDialog.classList.remove('active');
    modalOverlay.classList.remove('active');
    selectedItems.clear();
}

// Update selected items count
function updateSelectedItemsCount() {
    selectedItemsCountElement.textContent = selectedItems.size.toString();
}

// Navigate to directory
function navigateToDirectory(dirPath) {
    vscode.postMessage({
        type: 'fileBrowser',
        action: 'listDirectory',
        path: dirPath
    });
}

// Navigate up one directory
function navigateUp() {
    const currentPath = currentPathElement.textContent;
    if (currentPath) {
        const parentPath = path.dirname(currentPath);
        navigateToDirectory(parentPath);
    }
}

// Add event listeners for file browser buttons
upDirBtn.addEventListener('click', navigateUp);
homeBtn.addEventListener('click', () => {
    // Request workspace root directory
    vscode.postMessage({
        type: 'fileBrowser',
        action: 'listDirectory',
        path: ''  // Empty path means get workspace root
    });
});
selectAllBtn.addEventListener('click', selectAllItems);
closeBrowserBtn.addEventListener('click', hideFileBrowser);
cancelSelectBtn.addEventListener('click', hideFileBrowser);
confirmSelectBtn.addEventListener('click', () => {
    // Convert Set to Array for sending
    const selectedPaths = Array.from(selectedItems);

    // Send selected paths to extension
    vscode.postMessage({
        type: 'contextAction',
        action: 'addCustom',
        paths: selectedPaths
    });

    // Hide the dialog
    hideFileBrowser();
});

// Also close when clicking on the overlay
modalOverlay.addEventListener('click', hideFileBrowser);

// Function to select all items in the current directory
function selectAllItems() {
    // Get all file items in the current directory
    const fileItems = document.querySelectorAll('.file-item');

    fileItems.forEach(item => {
        const path = item.dataset.path;

        // Add to selected items set
        selectedItems.add(path);

        // Add selected class
        item.classList.add('selected');
    });

    // Update the count
    updateSelectedItemsCount();
}

// Update the file list in the UI
function updateFileList(items) {
    fileListElement.innerHTML = '';

    items.forEach(item => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        fileItem.dataset.path = item.path;
        fileItem.dataset.isDirectory = item.isDirectory;

        if (selectedItems.has(item.path)) {
            fileItem.classList.add('selected');
        }

        const icon = document.createElement('span');
        icon.className = `file-item-icon codicon ${item.isDirectory ? 'codicon-folder' : 'codicon-file'}`;

        const name = document.createElement('span');
        name.textContent = item.name;

        fileItem.appendChild(icon);
        fileItem.appendChild(name);

        // Add click handler
        fileItem.addEventListener('click', (e) => {
            if (item.isDirectory && e.detail === 2) {
                // Double click on directory - navigate into it
                navigateToDirectory(item.path);
            } else {
                // Single click - select/deselect
                if (selectedItems.has(item.path)) {
                    selectedItems.delete(item.path);
                    fileItem.classList.remove('selected');
                } else {
                    selectedItems.add(item.path);
                    fileItem.classList.add('selected');
                }
                updateSelectedItemsCount();
            }
        });

        fileListElement.appendChild(fileItem);
    });
}

// Modify the confirmSelectBtn click handler
confirmSelectBtn.addEventListener('click', () => {
    if (selectedItems.size > 0) {
        const selectedPaths = Array.from(selectedItems);
        console.log('Sending selected paths to extension:', selectedPaths);

        vscode.postMessage({
            type: 'contextAction',
            action: 'addCustom',
            paths: selectedPaths
        });

        // Hide the file browser dialog
        hideFileBrowser();
    }
});

// Update the selected items count
function updateSelectedItemsCount() {
    if (selectedItemsCountElement) {
        selectedItemsCountElement.textContent = selectedItems.size;
    }
}

// Show file browser dialog
function showFileBrowser() {
    // Reset state
    selectedItems.clear();
    updateSelectedItemsCount();

    // Request initial directory listing from extension
    vscode.postMessage({
        type: 'fileBrowser',
        action: 'listDirectory',
        path: '' // Empty path means get workspace root
    });

    // Show dialog and overlay
    fileBrowserDialog.style.display = 'flex';
    modalOverlay.style.display = 'block';
}

// Hide file browser dialog
function hideFileBrowser() {
    fileBrowserDialog.style.display = 'none';
    modalOverlay.style.display = 'none';
}

// Navigate to a directory
function navigateToDirectory(path) {
    currentPath = path;
    currentPathElement.textContent = path;

    // Clear selection when navigating
    selectedItems.clear();
    updateSelectedItemsCount();

    // Request directory listing from extension
    vscode.postMessage({
        type: 'fileBrowser',
        action: 'listDirectory',
        path: path
    });
}

// Navigate up one directory
function navigateUp() {
    if (!currentPath) return;

    const parentPath = currentPath.split('\\').slice(0, -1).join('\\');
    navigateToDirectory(parentPath || '');
}

// Handle messages from the extension
window.addEventListener('message', event => {
    const message = event.data;
    console.log('Received message from extension:', message);

    switch (message.type) {
        case 'updateContext':
            updateContextItems(message.contextItems);
            break;
        case 'addMessage':
            // Fix the parameter order and log for debugging
            console.log('Adding message:', message.role, message.content);
            addMessage(message.content, message.role);
            break;
        case 'typingIndicator':
            setTypingIndicator(message.isTyping);
            break;
        case 'fileBrowserUpdate':
            updateFileList(message.items);
            currentPathElement.textContent = message.currentPath;
            break;
        case 'startAIMessage':
            // Create a new message element with the given ID
            const aiMessageDiv = document.createElement('div');
            aiMessageDiv.id = message.messageId;
            aiMessageDiv.className = 'message assistant-message';
            aiMessageDiv.innerHTML = ''; // Start empty
            messagesContainer.appendChild(aiMessageDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
            break;

        case 'appendToAIMessage':
            const currentAiMessage = document.getElementById(message.messageId);
            if (currentAiMessage) {
                // We need to maintain the full markdown text to render it properly
                
                // If this is the first chunk, initialize the data attribute
                if (!currentAiMessage.hasAttribute('data-markdown-content')) {
                    currentAiMessage.setAttribute('data-markdown-content', '');
                }
                
                // Append the new chunk to our stored markdown content
                const currentMarkdown = currentAiMessage.getAttribute('data-markdown-content');
                const updatedMarkdown = currentMarkdown + message.content;
                currentAiMessage.setAttribute('data-markdown-content', updatedMarkdown);
                
                // Render the complete markdown content
                currentAiMessage.innerHTML = formatText(updatedMarkdown);
                
                // Explicitly highlight code blocks in this message
                currentAiMessage.querySelectorAll('pre code').forEach(block => {
                    if (!block.classList.contains('hljs')) {
                        hljs.highlightElement(block);
                    }
                });
                
                // Scroll to the bottom
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }
            break;

        case 'finalizeAIMessage':
            // Any final processing for the message (if needed)
            const finalMessage = document.getElementById(message.messageId);
            if (finalMessage) {
                // Add any final classes or processing
                finalMessage.classList.add('complete');
            }
            break;
    }
});

// Add a message to the chat - ensure this is the only definition of this function
function addMessage(content, role) {
    console.log(`Adding ${role} message to chat`);
    const messageElement = document.createElement('div');

    // Fix the class name to match both 'user' and 'assistant' roles
    messageElement.className = `message ${role}-message`;

    if (role === 'assistant' || role === 'ai') {
        // Handle both 'assistant' and 'ai' role names
        messageElement.innerHTML = formatText(content);
    } else {
        // For user messages, just use text content with pre-wrap
        messageElement.textContent = content;
    }

    messagesContainer.appendChild(messageElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    highlightCodeBlocks();
}

// Show/hide typing indicator - ensure this is the only definition
function setTypingIndicator(isTyping) {
    // Remove existing indicator if any
    const existingIndicator = document.getElementById('typing-indicator');
    if (existingIndicator) {
        existingIndicator.remove();
    }

    if (isTyping) {
        const typingIndicator = document.createElement('div');
        typingIndicator.className = 'typing-indicator';
        typingIndicator.id = 'typing-indicator';
        typingIndicator.textContent = 'AI is typing...';
        messagesContainer.appendChild(typingIndicator);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

// Add this at the end of your file
document.addEventListener('DOMContentLoaded', () => {
    // Initialize highlight.js as soon as possible
    if (typeof hljs !== 'undefined') {
        console.log('Initializing highlight.js immediately');
        highlightCodeBlocks();
    }

    // Add a MutationObserver to catch dynamically added content
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.addedNodes && mutation.addedNodes.length > 0) {
                // Check if any of the added nodes contain code blocks
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1) { // ELEMENT_NODE
                        const codeBlocks = node.querySelectorAll('pre code');
                        if (codeBlocks.length > 0) {
                            highlightCodeBlocks();
                        }
                    }
                });
            }
        });
    });

    // Start observing the messages container
    if (messagesContainer) {
        observer.observe(messagesContainer, { childList: true, subtree: true });
    }
});

// Also add this to highlight code blocks when new messages are added
function highlightCodeBlocks() {
    if (typeof hljs !== 'undefined') {
        console.log('Highlighting code blocks');
        document.querySelectorAll('pre code').forEach((block) => {
            if (!block.classList.contains('hljs')) {
                try {
                    hljs.highlightElement(block);
                } catch (err) {
                    console.error('Error highlighting code block:', err);
                }
            }
        });
    } else {
        console.error('highlight.js is not loaded');
    }
}

// Call this function after adding new messages to the chat
// For example, add it to the end of your addMessage function

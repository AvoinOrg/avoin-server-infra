const http = require('http');
const fs = require('fs');
const path = require('path');

// Store all action handlers
const actions = {};

// Function to load a single action
function loadAction(file) {
    const actionName = file.replace('.js', '').toLowerCase();
    try {
        // Clear require cache to get fresh module if it was changed
        delete require.cache[require.resolve(path.join(actionsDir, file))];

        // Import the action module
        const actionModule = require(path.join(actionsDir, file));

        // Store the action's action function
        actions[actionName] = actionModule.action ||
            function (req, res) {
                res.statusCode = 501;
                res.end(JSON.stringify({ error: `Action ${actionName} doesn't export a action function` }));
            };

        console.log(`Loaded action: ${actionName}`);
    } catch (error) {
        console.error(`Failed to load action ${file}:`, error);
    }
}

// Action to remove a action
function removeAction(file) {
    const actionName = file.replace('.js', '').toLowerCase();
    if (actions[actionName]) {
        delete actions[actionName];
        console.log(`Removed action: ${actionName}`);
    }
}

// Load all actions from the 'actions' directory
const actionsDir = path.join(__dirname, 'actions');
fs.readdirSync(actionsDir).forEach(file => {
    if (file.endsWith('.js')) {
        loadAction(file);
    }
});

// Watch for changes in the actions directory
fs.watch(actionsDir, (eventType, filename) => {
    if (filename && filename.endsWith('.js')) {
        if (eventType === 'rename') {
            // Check if the file exists (to distinguish between creation and deletion)
            if (fs.existsSync(path.join(actionsDir, filename))) {
                console.log(`Action file added: ${filename}`);
                loadAction(filename);
            } else {
                console.log(`Action file removed: ${filename}`);
                removeAction(filename);
            }
        } else if (eventType === 'change') {
            console.log(`Action file changed: ${filename}`);
            loadAction(filename);
        }
    }
});

// Create the server
const server = http.createServer((req, res) => {
    // Set response headers
    res.setHeader('Content-Type', 'application/json');

    // Parse the URL path
    const urlPath = req.url.split('?')[0].replace(/^\/+|\/+$/g, '');

    // Root path handler (list available actions)
    if (!urlPath) {
        res.statusCode = 200;
        res.end(JSON.stringify({
            status: 'ok',
            message: 'Action server running',
            availableActions: Object.keys(actions)
        }));
        return;
    }

    // Check if the action exists
    if (actions[urlPath]) {
        // Call the action's action function
        actions[urlPath](req, res);
    } else {
        // Action not found
        res.statusCode = 404;
        res.end(JSON.stringify({
            error: 'Action not found',
            availableActions: Object.keys(actions)
        }));
    }
});

// Start the server
const PORT = process.env.ACTIONSERVER_PORT || 9010;
server.listen(PORT, () => {
    console.log(`Action server running on port ${PORT}`);
    console.log(`Available actions: ${Object.keys(actions).join(', ')}`);
});
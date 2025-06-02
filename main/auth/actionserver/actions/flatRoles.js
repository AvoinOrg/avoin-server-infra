function action(req, res) {
    let body = [];
    req.on('data', (chunk) => {
        body.push(chunk);
    }).on('end', () => {
        body = Buffer.concat(body).toString();
        let requestData;

        try {
            requestData = JSON.parse(body);
        } catch (error) {
            console.error("Error parsing request JSON:", error);
            res.statusCode = 400; // Bad Request
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: "Invalid JSON in request body" }));
            return;
        }

        const newAppendedClaims = [];
        
        // ZITADEL action payload typically has claims under context.claims
        // If context or context.claims is not present, default to an empty object.
        const claimsFromZitadel = requestData.userinfo || {}
        
        // Regex to identify ZITADEL project role claims.
        // Assumes project IDs are numeric.
        // Example: urn:zitadel:iam:org:project:249571727204417539:roles
        const projectRoleClaimPattern = /^urn:zitadel:iam:org:project:([0-9]+):roles$/;

        for (const key in claimsFromZitadel) {
            if (projectRoleClaimPattern.test(key)) {
                const projectRolesObject = claimsFromZitadel[key];
                // Ensure projectRolesObject is an object and not null before trying to get its keys.
                if (typeof projectRolesObject === 'object' && projectRolesObject !== null) {
                    const roleNames = Object.keys(projectRolesObject);
                    if (roleNames.length > 0) {
                        newAppendedClaims.push({
                            key: `flat:${key}`, // New claim key, e.g., "flat:urn:zitadel:iam:org:project:..."
                            value: roleNames    // Array of role names, e.g., ["luonnonmetsakartat_admin", "luonnonmetsakartat_editor"]
                        });
                    }
                }
            }
        }

        // Construct the response payload.
        // This structure is based on the fields available in the original Go example.
        // You can populate set_user_metadata and append_log_claims if needed.
        const responsePayload = {
            // set_user_metadata: [
            //     // Example: { key: "your_metadata_key", value: Buffer.from("your_metadata_value").toString('base64') }
            // ],
            append_claims: newAppendedClaims,
            // append_log_claims: [
            //     // Example: "Processed flat roles"
            // ]
        };
        
        try {
            const jsonData = JSON.stringify(responsePayload);
            res.setHeader('Content-Type', 'application/json');
            res.statusCode = 200;
            res.end(jsonData);
        } catch (error) {
            console.error("Error marshalling JSON response:", error);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: "Internal server error creating response" }));
        }
    });
    req.on('error', (err) => {
        console.error("Request error:", err);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: "Request error" }));
    });
}

module.exports = { action };
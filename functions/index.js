// The Cloud Functions for Firebase SDK to create Cloud Functions and setup triggers.
const functions = require('firebase-functions');


exports.digSand = functions.https.onRequest((request, response) => {
    response.send("Sandbox is replying!");
});


/**
 * Implemented as a HTTPS callable function: f(data, context)
 */
exports.sendLocation = functions.https.onCall((data, context) => {
    // const location = data.location;                                                                                     // a location passed from the client
    // const uid = context.auth.uid;                                                                                       // auto-added to the request
    // const name = context.auth.token.name || null;
    // const picture = context.auth.token.picture || null;
    // const email = context.auth.token.email || null;

    // if (location.length === 0) {
    //     throw new functions.https.HttpsError('invalid-argument', 'Empty location provided.');
    // }

    console.log(data);

    return {                                                                                                            // sync return
        returnCode: "0000",
        returnMessage: "Location sent",
    }

});

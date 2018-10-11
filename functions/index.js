'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

const settings = {timestampsInSnapshots: true};                                                                         // to avoid warning in the console log
admin.firestore().settings(settings);


/**
 * Sandbox. Implemented as a HTTPS callable function: f(data, context)
 */
exports.digSand = functions.https.onCall((data, context) => {
    // const location = data.location;                                                                                  // a location passed from the client
    const uid = context.auth.uid;                                                                                       // context is auto-added to the request
    const name = context.auth.token.name || null;
    const picture = context.auth.token.picture || null;
    const email = context.auth.token.email || null;

    // if (location.length === 0) {
    //     throw new functions.https.HttpsError('invalid-argument', 'Empty location provided.');
    // }

    console.log(data);

    return {                                                                                                            // sync return
        returnCode: "00",
    }

});


/**
 * Send a location from a minor app to major apps
 * Implemented as a HTTPS callable function: f(data, context)
 */
exports.sendLocation = functions.https.onCall((data, context) => {
    console.log(data);

    return {                                                                                                            // sync return
        returnCode: "00",
    }

});


/**
 * Update a stored device token used for FCM
 * Implemented as a HTTPS callable function: f(data, context)
 */
exports.updateDeviceToken = functions.https.onCall((data, context) => {
    const userUid = context.auth.uid;
    const deviceToken = data.deviceToken;

    return admin.firestore()
        .collection('users')
        .doc(userUid)
        .set({ deviceToken: deviceToken})
        .then( (writeResult) => {
            return {
                returnCode: "00",
            }
        })
        .catch((error) => {
            console.log(`User UID ${userUid} error while updating ${deviceToken}: ${error}`);
            return {
                returnCode: "01",
                returnMessage: error,
            }
        })
    ;
});

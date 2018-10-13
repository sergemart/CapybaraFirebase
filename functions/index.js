'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

const settings = {timestampsInSnapshots: true};                                                                         // to avoid warning in the console log
admin.firestore().settings(settings);


/**
 * Send a location from a minor app to major apps
 * Implemented as a HTTPS callable function: f(data, context)
 */
exports.sendLocation = functions.https.onCall((data, context) => {
    console.log(data);

    if (!context.auth) throw new functions.https.HttpsError('failed-precondition', "Not authenticated");

    return {                                                                                                            // sync return
        returnCode: "00",
    }

});


/**
 * Update a stored device token used for FCM
 * Implemented as a HTTPS callable function: f(data, context)
 */
exports.updateDeviceToken = functions.https.onCall((data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('failed-precondition', "Not authenticated");

    const userUid = context.auth.uid;
    // const name = context.auth.token.name || null;
    // const picture = context.auth.token.picture || null;
    const email = context.auth.token.email || null;
    const deviceToken = data.deviceToken;

    return admin.firestore()                                                                                            // the Firestore client
        .collection('users')
        .doc(userUid)
        .set({ deviceToken: deviceToken})
        .then( (writeResult) => {
            return {
                returnCode: "00",
            }
        })
        .catch((error) => {
            console.log(`User ${email} error while updating ${deviceToken}: ${error}`);
            throw new functions.https.HttpsError('unknown', error);
        })
    ;
});


/**
 * Create a family
 * Implemented as a HTTPS callable function: f(data, context)
 */
exports.createFamily = functions.https.onCall((data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('failed-precondition', "Not authenticated");

    const userUid = context.auth.uid;
    // const name = context.auth.token.name || null;
    // const picture = context.auth.token.picture || null;
    const email = context.auth.token.email || null;
    let familyUid;

    return admin.firestore()                                                                                            // the Firestore client
        .collection('families')
        .add({ creator: userUid})
        .then( (writeResult) => {
            familyUid = writeResult.id;
            return {
                returnCode: "00",
                familyUid: familyUid,
            }
        })
        .catch((error) => {
            console.log(`User ${email} error while creating ${deviceToken}: ${error}`);
            throw new functions.https.HttpsError('unknown', error);
        })
    ;
});

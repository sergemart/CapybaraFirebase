'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

const settings = {timestampsInSnapshots: true};                                                                         // to avoid warning in the console log
admin.firestore().settings(settings);

const FieldValue = admin.firestore.FieldValue;


// --------------------------- Messaging

/**
 * Send a location from a minor app to major apps
 * Implemented as a HTTPS callable function f(data, context)
 */
exports.sendLocation = functions.https.onCall((data, context) => {
    console.log(data);

    if (!context.auth) throw new functions.https.HttpsError('failed-precondition', "Not authenticated");

    return {                                                                                                            // sync return
        returnCode: "00",
    }

});


// --------------------------- Messaging: Token

/**
 * Update a stored device token used for FCM
 * Implemented as a HTTPS callable function f(data, context) which is inserting or updating an attribute of a document
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
        .set({ deviceToken: deviceToken })                                                                               // insert or update
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


// --------------------------- Model CRUD: Family

/**
 * Create a family data, if no ones.
 * Return a uid of created or existing data.
 * Implemented as a HTTPS callable function f(data, context) which is reading a collection and inserting a document into it
 */
exports.createFamily = functions.https.onCall((data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('failed-precondition', "Not authenticated");

    const userUid = context.auth.uid;
    const email = context.auth.token.email || null;
    const familiesRef = admin.firestore().collection('families');
    let familyUid;

    return familiesRef.where('creator', '==', userUid)                                                                  // query for families created by the user
        .get()
        .then(querySnapshot => {
            if (querySnapshot.empty) {                                                                                  // no such families; creating one
                return familiesRef
                    .add({creator: userUid})
                    .then((writeResult) => {
                        familyUid = writeResult.id;
                        return {
                            returnCode: "00",
                            familyUid: familyUid,
                        }
                    })
                ;
            } else if (querySnapshot.size !== 1) {                                                                      // many such families; error
                console.log(`User ${email} has more than one family`);
                return {
                    returnCode: "90",
                }
            } else {                                                                                                    // the family already exists; return its id
                return {
                    returnCode: "01",
                    familyUid: querySnapshot.docs[0].id,                                                                // using DocumentSnapshot here
                }
            }
        })
        .catch((error) => {
            console.log(`User ${email} error while creating family data`);
            throw new functions.https.HttpsError('unknown', error);
        })
    ;
});


/**
 * Insert a family member into family data
 * Implemented as a HTTPS callable function f(data, context) which is inserting or updating an attribute of a document
 */
exports.createFamilyMember = functions.https.onCall((data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('failed-precondition', "Not authenticated");

    const userUid = context.auth.uid;
    const email = context.auth.token.email || null;
    const familyMemberEmail = data.familyMemberEmail;
    const familiesRef = admin.firestore().collection('families');

    return familiesRef.where('creator', '==', userUid)                                                                  // query for families created by the user
        .get()
        .then(querySnapshot => {
            if (querySnapshot.empty) {                                                                                  // no family; error
                console.log(`User ${email} owns no family data`);
                return {
                    returnCode: "91",
                }
            } else if (querySnapshot.size !== 1) {                                                                      // many such families; error
                console.log(`User ${email} has more than one family`);
                return {
                    returnCode: "90",
                }
            } else {                                                                                                    // the family exists; ok
                return admin.auth().getUserByEmail(familyMemberEmail)                                                   // get a member user record by a given email
                    .then( (userRecord) => {
                        return querySnapshot.docs[0].ref                                                                // get DocumentReference from DocumentSnapshot
                            .update({ members: FieldValue.arrayUnion(userRecord.uid) })
                            .then( (writeResult) => {
                                return {
                                    returnCode: "00",
                                }
                            })
                        ;
                    })
                ;
            }
        })
        .catch((error) => {
            console.log(`User ${email} error while storing family member ${familyMemberEmail}: ${error}`);
            throw new functions.https.HttpsError('unknown', error);
        })
    ;
});


/**
 * Remove a family member from family data
 * Implemented as a HTTPS callable function f(data, context) which is removing an attribute from a document
 */
exports.deleteFamilyMember = functions.https.onCall((data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('failed-precondition', "Not authenticated");

    const userUid = context.auth.uid;
    const email = context.auth.token.email || null;
    const familyMemberEmail = data.familyMemberEmail;
    const familiesRef = admin.firestore().collection('families');

    return familiesRef.where('creator', '==', userUid)                                                                  // query for families created by the user
        .get()
        .then(querySnapshot => {
            if (querySnapshot.empty) {                                                                                  // no family; error
                console.log(`User ${email} owns no family data`);
                return {
                    returnCode: "91",
                }
            } else if (querySnapshot.size !== 1) {                                                                      // many such families; error
                console.log(`User ${email} has more than one family`);
                return {
                    returnCode: "90",
                }
            } else {                                                                                                    // the family exists; ok
                return admin.auth().getUserByEmail(familyMemberEmail)                                                   // get a member user record by a given email
                    .then( (userRecord) => {
                        return querySnapshot.docs[0].ref                                                                // get DocumentReference from DocumentSnapshot
                            .update({ members: FieldValue.arrayRemove(userRecord.uid) })
                            .then( (writeResult) => {
                                return {
                                    returnCode: "00",
                                }
                            })
                        ;
                    })
                ;
            }
        })
        .catch((error) => {
            console.log(`User ${email} error while removing family member ${familyMemberEmail}: ${error}`);
            throw new functions.https.HttpsError('unknown', error);
        })
    ;
});

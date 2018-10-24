'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

const settings = {timestampsInSnapshots: true};                                                                         // to avoid warning in the console log
admin.firestore().settings(settings);

const FieldValue = admin.firestore.FieldValue;


/**
 * Send an invite to join a family from a major app to a minor app
 * Implemented as a HTTPS callable function f(data, context) which is
 * - getting an invitee user record from the system by the invitee email;
 * - getting an invitee device token from database by the invitee user uid;
 * - composing an invite message using device token;
 * - sending the message
 */
exports.sendInvite = functions.https.onCall((data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('failed-precondition', "Not authenticated");

    const userUid = context.auth.uid;
    const callerEmail = context.auth.token.email || null;
    const inviteeEmail = data.inviteeEmail;
    const usersRef = admin.firestore().collection('users');

    return admin.auth().getUserByEmail(inviteeEmail)
        .then( (userRecord) => {
            const userRef = usersRef.doc(userRecord.uid);
            return userRef.get()
                .then( (userSnapshot) => {
                    const deviceToken = userSnapshot.data().deviceToken;
                    const inviteMessage = {
                        token: deviceToken,
                        data: {
                            messageType: "invite",
                            invitingEmail: callerEmail,
                        }
                    };
                    return admin.messaging().send(inviteMessage)
                        .then( (messageId) => {
                            return {
                                returnCode: "00",
                                messageId: messageId,
                            }
                        })
                    ;
                })
            ;
        })
        .catch((error) => {
            console.log(`The invite message from ${callerEmail} not sent to ${inviteeEmail}: ${error}`);
            throw new functions.https.HttpsError('unknown', error);
        })
    ;
});


/**
 * Join a family and send an invite acceptance message.
 * Implemented as a HTTPS callable function f(data, context) which is
 *
 * - getting an inviting user record from the system by the inviting email;
 * - getting an inviting device token from database by the inviting user uid;
 * - composing an invite acceptance message using device token;
 * - sending the message
 */
exports.joinFamily = functions.https.onCall((data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('failed-precondition', "Not authenticated");

    const callerUid = context.auth.uid;
    const callerEmail = context.auth.token.email || null;
    const invitingEmail = data.invitingEmail;
    const usersRef = admin.firestore().collection('users');
    const familiesRef = admin.firestore().collection('families');

    return admin.auth().getUserByEmail(invitingEmail)
        .then( (invitingUserRecord) => {
            const invitingUserUid = invitingUserRecord.uid;
            return familiesRef.where('creator', '==', invitingUserUid)                                                  // query for families created by the inviting
                .get()
                .then(familyQuerySnapshot => {
                    if (familyQuerySnapshot.empty) {                                                                    // no family; error
                        console.log(`User ${invitingEmail} owns no family data`);
                        return {
                            returnCode: "91",
                        }
                    } else if (familyQuerySnapshot.size !== 1) {                                                        // many such families; error
                        console.log(`User ${invitingEmail} has more than one family`);
                        return {
                            returnCode: "90",
                        }
                    } else {                                                                                            // the family exists; ok
                        return familyQuerySnapshot.docs[0].ref
                            .update({ members: FieldValue.arrayUnion(callerUid) })
                            .then( (writeResult) => {
                                const invitingUserRef = usersRef.doc(invitingUserUid);
                                return invitingUserRef.get()
                                    .then( (invitingUserSnapshot) => {
                                        const invitingDeviceToken = invitingUserSnapshot.data().deviceToken;
                                        const acceptMessage = {
                                            token: invitingDeviceToken,
                                            data: {
                                                messageType: "acceptInvite",
                                                inviteeEmail: callerEmail,
                                            }
                                        };
                                        return admin.messaging().send(acceptMessage)
                                            .then( (messageId) => {
                                                return {
                                                    returnCode: "00",
                                                    messageId: messageId,
                                                }
                                            })
                                            .catch( (error) => {
                                                console.log(`The invite acceptance message from ${callerEmail} not sent to ${invitingEmail}: ${error}`);
                                                return {
                                                    returnCode: "93",
                                                    errorMessage: error,
                                                }
                                            })
                                        ;
                                    })
                                ;
                            })
                        ;
                    }
                })
            ;
        })
        .catch((error) => {
            console.log(`Unhandled error: ${error}`);
            throw new functions.https.HttpsError('unknown', error);
        })
    ;
});


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


/**
 * Update a stored device token used for FCM
 * Implemented as a HTTPS callable function f(data, context) which is
 * - getting a calling user document from the database by the system-provided uid;
 * - replacing the document content with new one containing a device token (TODO: make update instead of replace)
 */
exports.updateDeviceToken = functions.https.onCall((data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('failed-precondition', "Not authenticated");

    const callerUid = context.auth.uid;
    const callerEmail = context.auth.token.email || null;
    const deviceToken = data.deviceToken;

    return admin.firestore().collection('users')                                                                        // the Firestore client
        .doc(callerUid)
        .set({ deviceToken: deviceToken })                                                                               // insert or update
        .then( (writeResult) => {
            return {
                returnCode: "00",
            }
        })
        .catch((error) => {
            console.log(`User ${callerEmail} error while updating ${deviceToken}: ${error}`);
            throw new functions.https.HttpsError('unknown', error);
        })
    ;
});


// --------------------------- Model CRUD: Family

/**
 * Create a family data, if no ones.
 * Return a uid of created or existing data.
 * Implemented as a HTTPS callable function f(data, context) which is
 * - reading a collection and inserting a document into it
 */
exports.createFamily = functions.https.onCall((data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('failed-precondition', "Not authenticated");

    const callerUid = context.auth.uid;
    const callerEmail = context.auth.token.email || null;
    const familiesRef = admin.firestore().collection('families');
    let familyUid;

    return familiesRef.where('creator', '==', callerUid).get()                                                            // query for families created by the user
        .then(querySnapshot => {
            if (querySnapshot.empty) {                                                                                  // no such families; creating one
                return familiesRef
                    .add({creator: callerUid})
                    .then((writeResult) => {
                        familyUid = writeResult.id;
                        return {
                            returnCode: "00",
                            familyUid: familyUid,
                        }
                    })
                ;
            } else if (querySnapshot.size !== 1) {                                                                      // many such families; error
                console.log(`User ${callerEmail} has more than one family`);
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
            console.log(`User ${callerEmail} error while creating family data`);
            throw new functions.https.HttpsError('unknown', error);
        })
    ;
});


/**
 * Insert a family member into family data
 * Implemented as a HTTPS callable function f(data, context) which is
 * - inserting or updating an attribute of a document
 */
exports.createFamilyMember = functions.https.onCall((data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('failed-precondition', "Not authenticated");

    const callerUid = context.auth.uid;
    const callerEmail = context.auth.token.email || null;
    const familyMemberEmail = data.familyMemberEmail;
    const familiesRef = admin.firestore().collection('families');

    return familiesRef.where('creator', '==', callerUid)                                                                  // query for families created by the user
        .get()
        .then(querySnapshot => {
            if (querySnapshot.empty) {                                                                                  // no family; error
                console.log(`User ${callerEmail} owns no family data`);
                return {
                    returnCode: "91",
                }
            } else if (querySnapshot.size !== 1) {                                                                      // many such families; error
                console.log(`User ${callerEmail} has more than one family`);
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
            console.log(`User ${callerEmail} error while storing family member ${familyMemberEmail}: ${error}`);
            throw new functions.https.HttpsError('unknown', error);
        })
    ;
});


/**
 * Remove a family member from family data
 * Implemented as a HTTPS callable function f(data, context) which is
 * - removing an attribute from a document
 */
exports.deleteFamilyMember = functions.https.onCall((data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('failed-precondition', "Not authenticated");

    const callerUid = context.auth.uid;
    const callerEmail = context.auth.token.email || null;
    const familyMemberEmail = data.familyMemberEmail;
    const familiesRef = admin.firestore().collection('families');

    return familiesRef.where('creator', '==', callerUid)                                                                  // query for families created by the user
        .get()
        .then(querySnapshot => {
            if (querySnapshot.empty) {                                                                                  // no family; error
                console.log(`User ${callerEmail} owns no family data`);
                return {
                    returnCode: "91",
                }
            } else if (querySnapshot.size !== 1) {                                                                      // many such families; error
                console.log(`User ${callerEmail} has more than one family`);
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
            console.log(`User ${callerEmail} error while removing family member ${familyMemberEmail}: ${error}`);
            throw new functions.https.HttpsError('unknown', error);
        })
    ;
});

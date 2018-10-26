'use strict';

const MESSAGE_TYPE_LOCATION = 'location';
const MESSAGE_TYPE_INVITE = 'invite';
const MESSAGE_TYPE_ACCEPT_INVITE = 'acceptInvite';

const RETURN_CODE_OK = 'ok';
const RETURN_CODE_CREATED = 'created';
const RETURN_CODE_DELETED = 'deleted';
const RETURN_CODE_EXIST = 'exist';
const RETURN_CODE_NO_FAMILY = 'no_family';
const RETURN_CODE_MORE_THAN_ONE_FAMILY = 'many_families';
const RETURN_CODE_SENT = 'sent';
const RETURN_CODE_NOT_SENT = 'not_sent';
const RETURN_CODE_ALL_SENT = 'all_sent';
const RETURN_CODE_SOME_SENT = 'some_sent';
const RETURN_CODE_NONE_SENT = 'none_sent';

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

    const callerUid = context.auth.uid;
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
                            messageType: MESSAGE_TYPE_INVITE,
                            invitingEmail: callerEmail,
                        }
                    };
                    return admin.messaging().send(inviteMessage)
                        .then( (messageId) => {
                            return {
                                returnCode: RETURN_CODE_SENT,
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
 * - getting an inviting user record from the system by the inviting email;
 * - finding a family by the inviting user uid;
 * - inserting or updating an attribute of the family document
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
            return familiesRef.where('creator', '==', invitingUserUid).get()                                            // query for families created by the inviting
                .then(familyQuerySnapshot => {
                    if (familyQuerySnapshot.empty) {                                                                    // no family; error
                        console.log(`User ${invitingEmail} owns no family data`);
                        return {
                            returnCode: RETURN_CODE_NO_FAMILY,
                        }
                    } else if (familyQuerySnapshot.size !== 1) {                                                        // many such families; error
                        console.log(`User ${invitingEmail} has more than one family`);
                        return {
                            returnCode: RETURN_CODE_MORE_THAN_ONE_FAMILY,
                        }
                    } else {                                                                                            // the family exists; ok
                        return familyQuerySnapshot.docs[0].ref.update({
                            members: FieldValue.arrayUnion(callerUid)
                        })
                            .then( (writeResult) => {
                                const invitingUserRef = usersRef.doc(invitingUserUid);
                                return invitingUserRef.get()
                                    .then( (invitingUserSnapshot) => {
                                        const invitingDeviceToken = invitingUserSnapshot.data().deviceToken;
                                        const acceptMessage = {
                                            token: invitingDeviceToken,
                                            data: {
                                                messageType: MESSAGE_TYPE_ACCEPT_INVITE,
                                                inviteeEmail: callerEmail,
                                            }
                                        };
                                        return admin.messaging().send(acceptMessage)
                                            .then( (messageId) => {
                                                return {
                                                    returnCode: RETURN_CODE_OK,
                                                    messageId: messageId,
                                                }
                                            })
                                            .catch( (error) => {
                                                console.log(`The invite acceptance message from ${callerEmail} not sent to ${invitingEmail}: ${error}`);
                                                return {
                                                    returnCode: RETURN_CODE_NOT_SENT,
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
 * Send a location to family members
 * Implemented as a HTTPS callable function f(data, context) which is
 * - finds members of the family, which caller belongs to;
 * - for each member creates a chained atomic promise which gets the member's token and sends him a location message;
 * - makes a composite promise from an array of the atomic promises
 */
exports.sendLocation = functions.https.onCall((data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('failed-precondition', "Not authenticated");

    const callerUid = context.auth.uid;
    const callerEmail = context.auth.token.email || null;
    const location = data.location;
    const usersRef = admin.firestore().collection('users');
    const familiesRef = admin.firestore().collection('families');

    return familiesRef.where('members', 'array-contains', callerUid).get()                                              // query for families which the user belongs to
        .then(querySnapshot => {
            if (querySnapshot.empty) {                                                                                  // no such families; error
                console.log(`User ${callerEmail} has no family`);
                return {
                    returnCode: RETURN_CODE_NO_FAMILY,
                }
            } else if (querySnapshot.size !== 1) {                                                                      // many such families; error
                console.log(`User ${callerEmail} has more than one family`);
                return {
                    returnCode: RETURN_CODE_MORE_THAN_ONE_FAMILY,
                }
            } else {                                                                                                    // the family found; ok
                const memberUids = querySnapshot.docs[0].data().members;

                // Make up an array of promises
                let sendPromises = [];
                for (let memberUid of memberUids) {
                    if (memberUid === callerUid) continue;                                                               // do not send a message to self
                    let memberRef = usersRef.doc(memberUid);
                    let sendPromise = memberRef.get()
                        .then( (memberSnapshot) => {
                            let memberDeviceToken = memberSnapshot.data().deviceToken;
                            let locationMessage = {
                                token: memberDeviceToken,
                                data: {
                                    messageType: MESSAGE_TYPE_LOCATION,
                                    location: location,
                                    senderEmail: callerEmail,
                                }
                            };
                            return admin.messaging().send(locationMessage)
                                .then((messageId) => {
                                    return Promise.resolve(RETURN_CODE_SENT);                                           // then() returns a promise to make sendPromise be a promise in the end of the chain
                                })
                                .catch((error) => {
                                    console.log(`Message to ${memberUid} not sent: ${error}`);
                                    return Promise.resolve(RETURN_CODE_NOT_SENT);                                       // catch() returns a promise to make sendPromise be a promise in the end of the chain
                                })
                            ;
                        })
                    ;
                    sendPromises.push(sendPromise);
                }

                return Promise.all(sendPromises);                                                                       // this makes then() above be a promise and allows to chain it with the then() below
            }
        })
        .then( (arrayOfReturnCodes) => {
            if (arrayOfReturnCodes.includes(RETURN_CODE_SENT) && arrayOfReturnCodes.includes(RETURN_CODE_NOT_SENT)) {
                return {
                    returnCode: RETURN_CODE_SOME_SENT,
                }
            } else if (arrayOfReturnCodes.includes(RETURN_CODE_SENT) && !( arrayOfReturnCodes.includes(RETURN_CODE_NOT_SENT) )) {
                return {
                    returnCode: RETURN_CODE_ALL_SENT,
                }
            } else if ( !(arrayOfReturnCodes.includes(RETURN_CODE_SENT)) && arrayOfReturnCodes.includes(RETURN_CODE_NOT_SENT) ) {
                return {
                    returnCode: RETURN_CODE_NONE_SENT,
                }
            } else {
                throw new functions.https.HttpsError('internal', 'Wrong return codes from atomic promises');
            }
        })
        .catch((error) => {
            console.log(`The location messages from ${callerEmail} not sent: ${error}`);
            throw new functions.https.HttpsError('unknown', error);
        })
    ;
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

    return admin.firestore().collection('users').doc(callerUid).set({                                                   // insert or update
            deviceToken: deviceToken
        })
        .then( (writeResult) => {
            return {
                returnCode: RETURN_CODE_OK,
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

    return familiesRef.where('creator', '==', callerUid).get()                                                          // query for families created by the user
        .then(querySnapshot => {
            if (querySnapshot.empty) {                                                                                  // no such families; creating one
                return familiesRef.add({
                    creator: callerUid
                })
                    .then((familyRef) => {
                        familyUid = familyRef.id;
                        return familyRef.update({
                            members: FieldValue.arrayUnion(callerUid)
                        })
                            .then( (writeResult) => {
                                return {
                                    returnCode: RETURN_CODE_CREATED,
                                    familyUid: familyUid,
                                }
                            })
                        ;
                    })
                ;
            } else if (querySnapshot.size !== 1) {                                                                      // many such families; error
                console.log(`User ${callerEmail} has more than one family`);
                return {
                    returnCode: RETURN_CODE_MORE_THAN_ONE_FAMILY,
                }
            } else {                                                                                                    // the family already exists; return its id
                return {
                    returnCode: RETURN_CODE_EXIST,
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

    return familiesRef.where('creator', '==', callerUid).get()                                                          // query for families created by the user
        .then(querySnapshot => {
            if (querySnapshot.empty) {                                                                                  // no family; error
                console.log(`User ${callerEmail} owns no family data`);
                return {
                    returnCode: RETURN_CODE_NO_FAMILY,
                }
            } else if (querySnapshot.size !== 1) {                                                                      // many such families; error
                console.log(`User ${callerEmail} has more than one family`);
                return {
                    returnCode: RETURN_CODE_MORE_THAN_ONE_FAMILY,
                }
            } else {                                                                                                    // the family exists; ok
                return admin.auth().getUserByEmail(familyMemberEmail)                                                   // get a member user record by a given email
                    .then( (userRecord) => {
                        return querySnapshot.docs[0].ref.update({                                                       // get DocumentReference from DocumentSnapshot
                                members: FieldValue.arrayUnion(userRecord.uid)
                            })
                            .then( (writeResult) => {
                                return {
                                    returnCode: RETURN_CODE_CREATED,
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

    return familiesRef.where('creator', '==', callerUid).get()                                                          // query for families created by the user
        .then(querySnapshot => {
            if (querySnapshot.empty) {                                                                                  // no family; error
                console.log(`User ${callerEmail} owns no family data`);
                return {
                    returnCode: RETURN_CODE_NO_FAMILY,
                }
            } else if (querySnapshot.size !== 1) {                                                                      // many such families; error
                console.log(`User ${callerEmail} has more than one family`);
                return {
                    returnCode: RETURN_CODE_MORE_THAN_ONE_FAMILY,
                }
            } else {                                                                                                    // the family exists; ok
                return admin.auth().getUserByEmail(familyMemberEmail)                                                   // get a member user record by a given email
                    .then( (userRecord) => {
                        return querySnapshot.docs[0].ref.update({                                                       // get DocumentReference from DocumentSnapshot
                            members: FieldValue.arrayRemove(userRecord.uid)
                        })
                            .then( (writeResult) => {
                                return {
                                    returnCode: RETURN_CODE_DELETED,
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

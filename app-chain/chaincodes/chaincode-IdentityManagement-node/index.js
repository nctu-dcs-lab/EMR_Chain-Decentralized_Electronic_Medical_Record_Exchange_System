const { Contract } = require("fabric-contract-api");
const { createSign, createVerify } = require('crypto');
const ethers = require('ethers');

class IDMContract extends Contract {
  constructor() {
    super("IDMContract");
  }

  async instantiate() {
    // function that will be invoked on chaincode instantiation
  }

  async beforeTransaction(ctx){  // To verify the identity who commit the transaction
    const input = ctx.stub.getFunctionAndParameters() ;
    const commit_id = ctx.clientIdentity.getAttributeValue("user_id") ;
    const msp_id = ctx.clientIdentity.getMSPID() ;
    if ( input["fcn"] === "create_identity" || input["fcn"] === "consent_sup_role" || input["fcn"] === "revoke_sup_role" ) { // Only org1 ADMIN can create identity
      if ( commit_id != "org1ADMIN" || msp_id != "Org1MSP" ) {
        const log = "Only ADMIN can create the Identity ( Wrong commit_id: " + commit_id + " ) " + " (" + input["fcn"] + ")" ;
        throw new Error(log) ;   
      } // if 
    } // if
    else if ( input["fcn"] === "consent_doc_role" || input["fcn"] === "revoke_doc_role" ) { // Only org2 ADMIN can consent identity
      if ( commit_id != "org2ADMIN" || msp_id != "Org2MSP" ) {
        const log = "Only MHW can create/revoke the supervisor identity ( Wrong msp_id: " + msp_id + " ) " ;
        throw new Error(log) ;   
      } // if 
    } // else if
  } // beforeTransaction()

  async get(ctx, key) {
    const buffer = await ctx.stub.getState(key);
    if (!buffer || !buffer.length) return { error: "get NOT_FOUND" };
    let buffer_object = JSON.parse(buffer.toString()) ;
    console.log(buffer_object) ; 
    return buffer_object;
  } // for testing the ledger 

  async verify_role(ctx, appId) {
    const iterator = await ctx.stub.getQueryResult("{\"selector\":{\"AppId\":\"" + appId + "\"}}");
    let res = await iterator.next();
    const key = res.value.key ;
    let value = JSON.parse(res.value.value.toString("utf8")) ;
    await iterator.close() ; // close the iterator
    const role = value["Role"] ;
    return role ;
  } // verify_role()

  async getHealthLevel(ctx, appId) {
    const iterator = await ctx.stub.getQueryResult("{\"selector\":{\"AppId\":\"" + appId + "\"}}");
    let res = await iterator.next();
    const key = res.value.key ;
    let value = JSON.parse(res.value.value.toString("utf8")) ;
    await iterator.close() ; // close the iterator
    if (value["Role"] == "supervisor") 
      return value["HealthLevel"] ;
    else
      return "You are NOT supervisor!! (getHealthLevel) " ;
  } // getHealthLevel()

  async get_appId(ctx, key) {
    const buffer = await ctx.stub.getState(key);
    if (!buffer || !buffer.length) return { error: "get_appId NOT_FOUND" };
    let buffer_object = JSON.parse(buffer.toString()) ;
    return buffer_object["AppId"] ;
  } // get_appId()
  
  async create_identity(ctx, p_key, app_id, did, x509Cipher) {
    const buffer = await ctx.stub.getState(p_key);
    if ( buffer.length ) return { error: "(create_identity)DID EXIST" };;  

    // THE DATA-STRUCTURE of Identity mapping !!! 

    // key : { main identity public key }
    // value : { AppId : app_id,
    //           Role : role, 
    //           DID : did, 
    //           HealthLevel: level 
    //           x509Identity : x509 }

    let value = {
      AppId : app_id,
      Role : "patient",
      DID : did,
      HealthLevel: "none", 
      x509IdentityCipher : x509Cipher
    } ;
    
    await ctx.stub.putState(p_key, Buffer.from(JSON.stringify(value)));
    return { success: "OK (create_identity)"} ;   
  } // create_identity()

  async consent_doc_role(ctx, did) {
    const iterator = await ctx.stub.getQueryResult("{\"selector\":{\"DID\":\"" + did + "\"}}");
    let res = await iterator.next();
    const key = res.value.key ;
    let value = JSON.parse(res.value.value.toString("utf8")) ;
    await iterator.close() ; // close the iterator
    value["Role"] = "doctor" ;
    await ctx.stub.putState(key, Buffer.from(JSON.stringify(value)));
    return { success: "OK (consent_doc_role)",
             DID: did } ;   
  } // consent_doc_role()

  async consent_sup_role(ctx, did, level) {
    const iterator = await ctx.stub.getQueryResult("{\"selector\":{\"DID\":\"" + did + "\"}}");
    let res = await iterator.next();
    const key = res.value.key ;
    let value = JSON.parse(res.value.value.toString("utf8")) ;
    await iterator.close() ; // close the iterator
    value["Role"] = "supervisor" ;
    value["HealthLevel"] = level ;
    await ctx.stub.putState(key, Buffer.from(JSON.stringify(value)));
    return { success: "OK (consent_sup_role)",
             DID: did } ;   
  } // consent_sup_role()

  async revoke_doc_role(ctx, did) {
    const mspId = ctx.clientIdentity.getMSPID() ;
    const iterator = await ctx.stub.getQueryResult("{\"selector\":{\"DID\":\"" + did + "\"}}");
    let res = await iterator.next();
    const key = res.value.key ;
    let value = JSON.parse(res.value.value.toString("utf8")) ;
    await iterator.close() ; // close the iterator
    if ( value["Role"] != "doctor" )
      return { Error: did + " identity is not doctor!!" } ;
    value["Role"] = "patient" ; // revoke the identity, back to patient
    await ctx.stub.putState(key, Buffer.from(JSON.stringify(value)));
    return { success: "OK (revoke_doc_role)",
             MSP: mspId } ;   
  } // revoke_doc_role()

  async revoke_sup_role(ctx, did) {
    const mspId = ctx.clientIdentity.getMSPID() ;
    const iterator = await ctx.stub.getQueryResult("{\"selector\":{\"DID\":\"" + did + "\"}}");
    let res = await iterator.next();
    const key = res.value.key ;
    let value = JSON.parse(res.value.value.toString("utf8")) ;
    await iterator.close() ; // close the iterator
    if ( value["Role"] != "supervisor" )
      return { Error: did + " identity is not supervisor!!" } ;
    value["Role"] = "patient" ; // revoke the identity, back to patient
    value["HealthLevel"] = "none" ; // revoke the HealthLevel, back to patient
    await ctx.stub.putState(key, Buffer.from(JSON.stringify(value)));
    return { success: "OK (revoke_sup_role)",
             MSP: mspId } ;   
  } // revoke_doc_role()

  async authenticate_identity(ctx, p_key, signature, patientId) {
    const buffer = await ctx.stub.getState(p_key);
    if (!buffer || !buffer.length) return { error: "(authenticate_identity) Can't find the account, Please regist first!!" };
    const buffer_object = JSON.parse(buffer.toString()) ;
    const message = ethers.utils.toUtf8Bytes("message") ;
    const recoveredAddress = ethers.utils.verifyMessage(message, signature) ;
    const isVerified = recoveredAddress == p_key ;
    if ( isVerified) {
      if ( patientId == "none" || buffer_object["AppId"] == patientId )
        return buffer_object["Role"] ;
    } // if
    else 
      return "Authenticate Fail!!!" ;
  } // authenticate_role

  async login(ctx, p_key, signature, message) {
    // // 使用 crypto module verify
    // const verify = crypto.createVerify('SHA256') ;
    // verify.update(message) ;
    // verify.end() ;
    // const isVerified = verify.verify(p_key, signature) ;
    // if ( isVerified ) { 
    //   const buffer = await ctx.stub.getState(p_key);
    //   if (!buffer || !buffer.length) return { error: "(login) Can't find the account, Please regist first!!" };
    //   return JSON.parse(buffer.toString()) ;
    // } // if 
    
    // 使用 ether.js module verifier
    message = ethers.utils.toUtf8Bytes(message) ;
    const recoveredAddress = ethers.utils.verifyMessage(message, signature) ;
    const isVerified = recoveredAddress == p_key ;
    if ( isVerified ) {
      const buffer = await ctx.stub.getState(p_key);
      if (!buffer || !buffer.length) return { error: "(login) Can't find the account, Please regist first!!" };
      return JSON.parse(buffer.toString()) ;
    } // if 

    return { error : "Verify Failed! You are not the user!!",
             RecoverAddress : recoveredAddress,
             PublicKey : p_key,
             Signature : signature,
             Message : message } ;
  } // login()
} // IDMContract()

exports.contracts = [IDMContract];

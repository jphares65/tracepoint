import {EmailDeliveryUnconfirmedError,EmailProviderConfigurationError,EmailProviderResponseError,type EmailProvider,type EmailMessage} from './provider-core';
export type OutboxDeliveryOutcome={kind:'sent';messageId:string|null}|{kind:'retry'|'failed'|'reconcile';message:string;messageId:string|null};
// Automatic retry is allowed only after an explicit throttling rejection.
// Transport/server errors and acceptance-persistence failures require review.
export async function deliverOutboxMessage(provider:EmailProvider,message:EmailMessage,record:(messageId:string|null)=>Promise<void>):Promise<OutboxDeliveryOutcome>{
 let accepted=false,messageId:string|null=null;
 try{const result=await provider.send(message);accepted=true;messageId=result.messageId;if(!messageId)throw new EmailDeliveryUnconfirmedError();await record(messageId);return {kind:'sent',messageId};}
 catch(error){
  if(accepted||error instanceof EmailDeliveryUnconfirmedError)return {kind:'reconcile',message:'Delivery may have been accepted. Reconcile provider events before any resend.',messageId};
  if(error instanceof EmailProviderResponseError&&error.status===429)return {kind:'retry',message:'Provider explicitly rejected delivery due to rate limiting.',messageId:null};
  if(error instanceof EmailProviderConfigurationError||error instanceof EmailProviderResponseError&&error.status>=400&&error.status<500)return {kind:'failed',message:'Delivery blocked by configuration, suppression or explicit provider rejection.',messageId:null};
  return {kind:'reconcile',message:'Delivery outcome is unknown. Reconcile provider events before any resend.',messageId:null};
 }
}

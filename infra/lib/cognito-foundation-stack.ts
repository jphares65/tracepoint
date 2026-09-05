import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
export interface CognitoFoundationProps extends cdk.StackProps { environmentName:'staging'|'production'; }
export class CognitoFoundationStack extends cdk.Stack {
 constructor(scope:Construct,id:string,props:CognitoFoundationProps){
  super(scope,id,props);
  if(this.region!=='us-east-1'||this.account==='265544358665'||(props.environmentName==='staging'?this.account!=='559054714699':this.account==='559054714699'))throw Error('Cognito account/environment boundary');
  const site=props.environmentName==='staging'?'https://staging.tracepointhq.com':'https://tracepointhq.com';
  const pool=new cognito.UserPool(this,'Users',{
   userPoolName:'tracepoint-'+props.environmentName,featurePlan:cognito.FeaturePlan.ESSENTIALS,
   selfSignUpEnabled:false,signInAliases:{email:true},signInCaseSensitive:false,autoVerify:{email:true},
   accountRecovery:cognito.AccountRecovery.EMAIL_ONLY,mfa:cognito.Mfa.REQUIRED,mfaSecondFactor:{otp:true,sms:false},
   passwordPolicy:{minLength:14,requireLowercase:true,requireUppercase:true,requireDigits:true,requireSymbols:true,tempPasswordValidity:cdk.Duration.days(1)},
   deletionProtection:true,removalPolicy:cdk.RemovalPolicy.RETAIN,
  });
  const client=pool.addClient('Application',{
   userPoolClientName:'tracepoint-'+props.environmentName+'-web',generateSecret:false,
   authFlows:{userSrp:true},preventUserExistenceErrors:true,enableTokenRevocation:true,
   accessTokenValidity:cdk.Duration.minutes(5),idTokenValidity:cdk.Duration.minutes(5),refreshTokenValidity:cdk.Duration.days(1),
   refreshTokenRotationGracePeriod:cdk.Duration.seconds(10),
   readAttributes:new cognito.ClientAttributes().withStandardAttributes({email:true,emailVerified:true}),
   writeAttributes:new cognito.ClientAttributes().withStandardAttributes({email:true}),
   oAuth:{flows:{authorizationCodeGrant:true,implicitCodeGrant:false,clientCredentials:false},
    scopes:[cognito.OAuthScope.OPENID,cognito.OAuthScope.EMAIL],callbackUrls:[site+'/api/auth/cognito/callback'],logoutUrls:[site+'/login']},
  });
  // Explicitly exclude the incompatible legacy refresh-token auth flow.
  (client.node.defaultChild as cognito.CfnUserPoolClient).explicitAuthFlows=['ALLOW_USER_SRP_AUTH'];
  const domain=pool.addDomain('ManagedDomain',{cognitoDomain:{domainPrefix:'tracepoint-'+props.environmentName+'-'+this.account}});
  new cdk.CfnOutput(this,'UserPoolId',{value:pool.userPoolId});new cdk.CfnOutput(this,'ClientId',{value:client.userPoolClientId});
  new cdk.CfnOutput(this,'ManagedDomain',{value:domain.baseUrl()});
  new cdk.CfnOutput(this,'ActivationGate',{value:'DISABLED: no application provider switch; callback, PKCE, lifecycle, revocation and RLS compatibility must pass before activation.'});
 }
}

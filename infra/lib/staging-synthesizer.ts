import * as cdk from 'aws-cdk-lib';
// GitHub's role already carries a narrow staging policy. Do not chain it into
// the broader bootstrap deployment/publishing/lookup roles.
export const directStagingSynthesizer=()=>new cdk.DefaultStackSynthesizer({deployRoleArn:'',fileAssetPublishingRoleArn:'',imageAssetPublishingRoleArn:'',lookupRoleArn:'',useLookupRoleForStackOperations:false});

// Shared parser for feedback construction and certificate validation. Supporting
// a partition in a parser does not authorize deployment into that partition.
export function parseSnsTopic(arn:string){
 const match=/^arn:(aws|aws-us-gov):sns:([a-z0-9-]+):(\d{12}):[A-Za-z0-9_-]+$/.exec(arn);
 if(!match||match[3]==='265544358665')throw Error('Invalid SNS topic boundary.');
 const [,partition,region,account]=match;
 if(partition==='aws-us-gov'?!/^us-gov-(east|west)-1$/.test(region):
  !/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(region)||region.startsWith('us-gov-')||region.startsWith('cn-'))throw Error('Invalid SNS topic boundary.');
 return {partition,region,account};
}

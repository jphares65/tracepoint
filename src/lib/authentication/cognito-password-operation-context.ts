export function passwordOperationContext(input: {
  actorUserId: string;
  departmentId: string;
  supportMode?: boolean;
}) {
  return {
    subjectId: input.actorUserId,
    departmentId: input.departmentId,
    supportMode: input.supportMode === true,
  };
}

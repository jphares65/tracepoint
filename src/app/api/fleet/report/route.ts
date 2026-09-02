import { NextResponse } from "next/server";
import { createFleetReadRepository } from "@/lib/fleet/read-repository";
import { accessFailureResponse, hasAnyServerPermission, permissionDeniedResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";
import { canViewNetworkDetails } from "@/lib/tracepoint/fleet-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);
  const context = resolved.context;
  if (!hasAnyServerPermission(context, ["view_fleet","manage_fleet","administer_department"])) return permissionDeniedResponse("Fleet-view permission is required.");
  try {
    const repository=createFleetReadRepository(context.admin,context.departmentId);
    const {items:vehicles}=await repository.getVehicleList({departmentId:context.departmentId,vehicleFields:"*"});
    const details=await Promise.all(vehicles.map((vehicle)=>repository.getVehicleDetail({departmentId:context.departmentId,vehicleId:String(vehicle.id),canViewNetworkDetails:(rules)=>canViewNetworkDetails(context,rules)})));
    return NextResponse.json({vehicles,workOrders:details.flatMap((detail)=>detail?.workOrders??[]),equipment:details.flatMap((detail)=>detail?.equipment??[]),inspections:details.flatMap((detail)=>detail?.inspections??[])} ,{headers:{"Cache-Control":"no-store"}});
  } catch(error) { return NextResponse.json({error:error instanceof Error?error.message:"Fleet report data could not be loaded."},{status:500}); }
}

import assert from "node:assert/strict";
import test from "node:test";
import { firearmValues,inferFirearmFromPerson,inferPersonFromFirearm,personValues,qualificationValues } from "./resolvers";
const person={id:"p",full_name:"John Smith",badge_number:"123",rank_title:"Officer",email:"john@example.test",is_active:true};
const firearm={id:"f",make:"Glock",model:"45",serial_number:"ABC",caliber:"9mm",firearm_type:"Duty",assigned_to_user_id:"p"};
test("resolves person, firearm, and qualification values",()=>{assert.equal(personValues(person)["person.badge_number"],"123");assert.equal(firearmValues(firearm,"John Smith")["firearm.serial_number"],"ABC");assert.equal(qualificationValues({id:"q",score:92,passed:true})["qualification.result"],"Pass")});
test("only one current firearm is inferred",()=>{assert.equal(inferFirearmFromPerson("p",[firearm])?.id,"f");assert.equal(inferFirearmFromPerson("p",[firearm,{...firearm,id:"f2"}]),null)});
test("firearm infers only its valid assigned person",()=>{assert.equal(inferPersonFromFirearm(firearm,[person])?.id,"p");assert.equal(inferPersonFromFirearm(firearm,[{...person,is_active:false}]),null)});

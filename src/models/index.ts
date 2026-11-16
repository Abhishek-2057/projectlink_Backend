import { Model } from './base.js';
import {
  IUser,
  IStudentProfile,
  ICompanyProfile,
  ITeam,
  ITeamMembership,
  ITeamInvitation,
  IProject,
  IApplication,
  IAssessment,
  IAssessmentSubmission,
  IProjectWorkspace,
  ITask,
  IMilestone,
  IDeliverable,
  IConversation,
  IMessage,
  INotification,
  IBookmark,
  IReview,
  IVerificationRequest,
  IActivityLog,
} from '../types/index.js';

export const User = new Model<IUser>('users');
export const StudentProfile = new Model<IStudentProfile>('studentProfiles');
export const CompanyProfile = new Model<ICompanyProfile>('companyProfiles');
export const Team = new Model<ITeam>('teams');
export const TeamMembership = new Model<ITeamMembership>('teamMemberships');
export const TeamInvitation = new Model<ITeamInvitation>('teamInvitations');
export const Project = new Model<IProject>('projects');
export const Application = new Model<IApplication>('applications');
export const Assessment = new Model<IAssessment>('assessments');
export const AssessmentSubmission = new Model<IAssessmentSubmission>('assessmentSubmissions');
export const ProjectWorkspace = new Model<IProjectWorkspace>('projectWorkspaces');
export const Task = new Model<ITask>('tasks');
export const Milestone = new Model<IMilestone>('milestones');
export const Deliverable = new Model<IDeliverable>('deliverables');
export const Conversation = new Model<IConversation>('conversations');
export const Message = new Model<IMessage>('messages');
export const Notification = new Model<INotification>('notifications');
export const Bookmark = new Model<IBookmark>('bookmarks');
export const Review = new Model<IReview>('reviews');
export const VerificationRequest = new Model<IVerificationRequest>('verificationRequests');
export const ActivityLog = new Model<IActivityLog>('activityLogs');

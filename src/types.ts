export type Todo = {
	id: string;
	text: string;
	completed: boolean;
	editing: boolean;
	important?: boolean;
	createdAt?: string;
	completedAt?: string;
};

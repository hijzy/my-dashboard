import { FormEvent, PointerEvent, memo, useEffect } from 'react';
import type { Todo } from './types';

type ItemCardProps = {
	todo: Todo;
	formatTimestamp: (value?: string) => string;
	handleCompleteTodo: () => void;
	handleEditTodo: () => void;
	handleSaveTodo: (event: FormEvent<HTMLFormElement>) => void;
	handleDeleteTodo: () => void;
	handleMarkImportant: () => void;
	onPointerDragStart: (event: PointerEvent<HTMLButtonElement>) => void;
	dropdownOpen: boolean;
	onDropdownOpenChange: (open: boolean) => void;
	isDragging: boolean;
	isDropTarget: boolean;
	shiftDirection: 'up' | 'down' | '';
	isRecentlyMoved: boolean;
};

const ItemCard = memo(function ItemCard(props: ItemCardProps) {
	const timeText = props.todo.completed ? props.formatTimestamp(props.todo.completedAt) : props.formatTimestamp(props.todo.createdAt);

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			const target = event.target;
			if (!(target instanceof Element)) {
				return;
			}
			if (!target.closest('.dropdown')) {
				props.onDropdownOpenChange(false);
			}
		};
		document.addEventListener('mousedown', handleClickOutside);
		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
		};
	}, [props.onDropdownOpenChange]);

	const itemClassName = [
		'todo-item',
		props.todo.completed ? 'completed' : '',
		props.todo.important ? 'is-important' : '',
		props.todo.editing ? 'is-editing' : '',
		props.dropdownOpen ? 'dropdown-open' : '',
		props.isDragging ? 'dragging' : '',
		props.isDropTarget ? 'drop-before' : '',
		props.shiftDirection === 'down' ? 'shift-down' : '',
		props.isRecentlyMoved ? 'recently-moved' : ''
	]
		.filter(Boolean)
		.join(' ');

	return (
		<li className={itemClassName} data-todo-id={props.todo.id}>
			<button
				type="button"
				className="drag-handle"
				onPointerDown={props.onPointerDragStart}
				aria-label="Drag todo"
			>
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<circle cx="8" cy="6" r="1.4" />
					<circle cx="16" cy="6" r="1.4" />
					<circle cx="8" cy="12" r="1.4" />
					<circle cx="16" cy="12" r="1.4" />
					<circle cx="8" cy="18" r="1.4" />
					<circle cx="16" cy="18" r="1.4" />
				</svg>
			</button>

			<div className="tooltip-wrapper">
				<button type="button" onClick={props.handleCompleteTodo} className="complete-button" aria-label={props.todo.completed ? 'Mark as uncompleted' : 'Mark as completed'}>
					<svg viewBox="0 0 24 24" aria-hidden="true">
						<path d="M7 12.5 10.3 16 17 8.8" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
					</svg>
				</button>
				<div className="tooltip">
					<span>{props.todo.completed ? 'Mark as uncompleted' : 'Mark as completed'}</span>
				</div>
			</div>

			{props.todo.editing ? (
				<form onSubmit={props.handleSaveTodo} className="edit-form">
					<input
						type="text"
						name="editTodo"
						defaultValue={props.todo.text}
						className="edit-input"
						autoComplete="off"
						autoFocus={props.todo.editing}
					/>
					<div className="tooltip-wrapper">
						<button type="submit" className="no-fill-icon-button" aria-label="Save changes">
							<svg viewBox="0 0 24 24" aria-hidden="true">
								<path d="M7 12.5 10.3 16 17 8.8" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
							</svg>
						</button>
						<div className="tooltip">
							<span>Save changes</span>
						</div>
					</div>
				</form>
				) : (
				<div className="todo-main">
					<p className="todo-text">{props.todo.text}</p>
					{timeText && (
						<p className={`todo-meta ${props.todo.completed ? 'is-completed' : ''}`}>
							<span className="todo-meta-icon" aria-hidden="true">
								{props.todo.completed ? (
									<svg viewBox="0 0 16 16">
										<path d="M3.5 8.2 6.3 11l6.2-6.3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
									</svg>
								) : (
									<svg viewBox="0 0 16 16">
										<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
										<path d="M8 4.7v3.6l2.3 1.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
									</svg>
								)}
							</span>
							<span>{props.todo.completed ? `Completed at ${timeText}` : `Created at ${timeText}`}</span>
						</p>
					)}
				</div>
			)}

			<div className="right">
				<div className="tooltip-wrapper star-slot">
					<button type="button" className="no-fill-icon-button star-button" onClick={props.handleMarkImportant} aria-label={props.todo.important ? 'Remove importance' : 'Mark as important'}>
						<span className={`glyph-icon star-glyph ${props.todo.important ? 'is-active' : ''}`} aria-hidden="true">
							★
						</span>
					</button>
					<div className="tooltip">
						<span>{props.todo.important ? 'Remove importance' : 'Mark as important'}</span>
					</div>
				</div>

				<div className="dropdown dropdown-slot">
					<div className="tooltip-wrapper">
						<button type="button" className="no-fill-icon-button" onClick={() => props.onDropdownOpenChange(!props.dropdownOpen)} aria-label="More options" aria-expanded={props.dropdownOpen}>
							<span className="glyph-icon more-glyph" aria-hidden="true">•••</span>
						</button>
						<div className="tooltip">
							<span>More options</span>
						</div>
					</div>

					<div className={`dropdown-content ${props.dropdownOpen ? 'show' : ''}`}>
						<button
							type="button"
							tabIndex={props.dropdownOpen ? 0 : -1}
							onClick={() => {
								props.onDropdownOpenChange(false);
								props.handleEditTodo();
							}}
							className="dropdown-item"
						>
							<svg viewBox="0 0 24 24" aria-hidden="true">
								<path d="M4 20l4-.8L18 9.2 14.8 6 4.8 16 4 20Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
								<path d="m13.8 7 3.2 3.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
							</svg>
							<span>Edit task</span>
						</button>

						<button
							type="button"
							tabIndex={props.dropdownOpen ? 0 : -1}
							onClick={() => {
								props.onDropdownOpenChange(false);
								props.handleCompleteTodo();
							}}
							className="dropdown-item"
						>
							<svg viewBox="0 0 24 24" aria-hidden="true">
								<path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
								<path d="M8.5 12.2 11 14.7 15.8 9.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
							</svg>
							<span>{props.todo.completed ? 'Mark as uncompleted' : 'Mark as completed'}</span>
						</button>

						<button
							type="button"
							tabIndex={props.dropdownOpen ? 0 : -1}
							onClick={() => {
								props.onDropdownOpenChange(false);
								props.handleMarkImportant();
							}}
							className="dropdown-item"
						>
							<svg viewBox="0 0 24 24" aria-hidden="true">
								<path d="m12 3.8 2.6 5.3 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.2 5.9-.8L12 3.8Z" fill={props.todo.important ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
							</svg>
							<span>{props.todo.important ? 'Remove importance' : 'Mark as important'}</span>
						</button>

						<button
							type="button"
							tabIndex={props.dropdownOpen ? 0 : -1}
							onClick={() => {
								props.onDropdownOpenChange(false);
								props.handleDeleteTodo();
							}}
							className="dropdown-item danger"
						>
							<svg viewBox="0 0 24 24" aria-hidden="true">
								<path d="M6 7h12M9 7V5h6v2M8 7l.7 11.2A2 2 0 0 0 10.7 20h2.6a2 2 0 0 0 2-1.8L16 7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
							</svg>
							<span>Delete task</span>
						</button>
					</div>
				</div>
			</div>
		</li>
	);
});

export default ItemCard;

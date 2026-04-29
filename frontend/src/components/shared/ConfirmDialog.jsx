import Modal from './Modal.jsx';

export default function ConfirmDialog({ message, onConfirm, onClose }) {
  return (
    <Modal title="Confirm" onClose={onClose}>
      <p>{message}</p>
      <div className="form-actions">
        <button className="btn btn-danger" onClick={onConfirm}>Delete</button>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}
